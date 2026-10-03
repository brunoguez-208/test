//! Cola de exportación: los trabajos corren de a uno, en segundo plano, en el
//! orden de la cola. Se pueden cancelar (en espera o en curso), reordenar los
//! que esperan y quitar los terminados.

use crate::error::{AppError, ErrorKind};
use crate::project_export::{ExportJob, JobProgress, ProjectOutcome};
use crate::runner::JobControl;
use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum ItemStatus {
    Queued,
    Running { progress: Option<JobProgress> },
    Done { outcome: ProjectOutcome },
    Failed { error: AppError },
    Cancelled,
}

impl ItemStatus {
    pub fn is_finished(&self) -> bool {
        matches!(self, ItemStatus::Done { .. } | ItemStatus::Failed { .. } | ItemStatus::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: u64,
    pub title: String,
    /// Proyecto de origen (para marcarlo como exportado).
    pub project_id: String,
    pub status: ItemStatus,
    #[serde(skip)]
    pub job: ExportJob,
}

/// Lo que ejecuta cada trabajo (en la app, `export_project`; en los tests, un falso).
pub type Executor =
    Arc<dyn Fn(&ExportJob, &JobControl, &mut dyn FnMut(JobProgress)) -> Result<ProjectOutcome, AppError> + Send + Sync>;
/// Aviso de cambios (la UI recibe la cola entera).
pub type Listener = Arc<dyn Fn(&[QueueItem]) + Send + Sync>;
/// Aviso de un trabajo terminado (notificación de Windows).
pub type Finished = Arc<dyn Fn(&QueueItem) + Send + Sync>;

struct State {
    items: Vec<QueueItem>,
    running: Option<(u64, JobControl)>,
    next_id: u64,
    shutdown: bool,
}

pub struct ExportQueue {
    state: Arc<(Mutex<State>, Condvar)>,
    listener: Listener,
}

impl ExportQueue {
    /// Crea la cola y arranca el hilo que procesa los trabajos.
    pub fn start(executor: Executor, listener: Listener, finished: Finished) -> Self {
        let state = Arc::new((Mutex::new(State { items: vec![], running: None, next_id: 1, shutdown: false }), Condvar::new()));
        let q = Self { state: state.clone(), listener: listener.clone() };
        std::thread::spawn(move || worker(state, executor, listener, finished));
        q
    }

    fn notify(&self, st: &State) {
        (self.listener)(&st.items);
    }

    pub fn enqueue(&self, job: ExportJob, title: String) -> u64 {
        let (lock, cv) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        let id = st.next_id;
        st.next_id += 1;
        let project_id = job.project.id.clone();
        st.items.push(QueueItem { id, title, project_id, status: ItemStatus::Queued, job });
        self.notify(&st);
        cv.notify_all();
        id
    }

    pub fn snapshot(&self) -> Vec<QueueItem> {
        self.state.0.lock().unwrap_or_else(|p| p.into_inner()).items.clone()
    }

    /// Cancela un trabajo: si espera, no corre; si está corriendo, se mata FFmpeg.
    pub fn cancel(&self, id: u64) {
        let (lock, _) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((rid, ctl)) = &st.running {
            if *rid == id {
                ctl.cancel();
                return;
            }
        }
        if let Some(it) = st.items.iter_mut().find(|i| i.id == id && i.status == ItemStatus::Queued) {
            it.status = ItemStatus::Cancelled;
            self.notify(&st);
        }
    }

    /// Mueve un trabajo en espera a la posición `index` entre los que esperan.
    pub fn reorder(&self, id: u64, index: usize) {
        let (lock, _) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        let Some(from) = st.items.iter().position(|i| i.id == id && i.status == ItemStatus::Queued) else { return };
        let item = st.items.remove(from);
        let queued: Vec<usize> = st.items.iter().enumerate().filter(|(_, i)| i.status == ItemStatus::Queued).map(|(k, _)| k).collect();
        let at = if index >= queued.len() {
            queued.last().map(|k| k + 1).unwrap_or(st.items.len())
        } else {
            queued[index]
        };
        st.items.insert(at, item);
        self.notify(&st);
    }

    /// Quita un trabajo terminado (o todos los terminados con `None`).
    pub fn remove_finished(&self, id: Option<u64>) {
        let (lock, _) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        st.items.retain(|i| !(i.status.is_finished() && id.is_none_or(|x| x == i.id)));
        self.notify(&st);
    }

    pub fn is_busy(&self) -> bool {
        let st = self.state.0.lock().unwrap_or_else(|p| p.into_inner());
        st.running.is_some() || st.items.iter().any(|i| i.status == ItemStatus::Queued)
    }
}

impl Drop for ExportQueue {
    fn drop(&mut self) {
        let (lock, cv) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        st.shutdown = true;
        if let Some((_, ctl)) = &st.running {
            ctl.cancel();
        }
        cv.notify_all();
    }
}

fn worker(state: Arc<(Mutex<State>, Condvar)>, executor: Executor, listener: Listener, finished: Finished) {
    let (lock, cv) = &*state;
    loop {
        // Esperar el próximo trabajo.
        let (id, job, ctl) = {
            let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
            loop {
                if st.shutdown {
                    return;
                }
                if let Some(it) = st.items.iter_mut().find(|i| i.status == ItemStatus::Queued) {
                    it.status = ItemStatus::Running { progress: None };
                    let (id, job) = (it.id, it.job.clone());
                    let ctl = JobControl::new();
                    st.running = Some((id, ctl.clone()));
                    listener(&st.items);
                    break (id, job, ctl);
                }
                st = cv.wait(st).unwrap_or_else(|p| p.into_inner());
            }
        };

        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let mut on_progress = |p: JobProgress| {
            if last_emit.elapsed() < Duration::from_millis(100) && p.percent < 99.0 {
                return;
            }
            last_emit = Instant::now();
            let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(it) = st.items.iter_mut().find(|i| i.id == id) {
                it.status = ItemStatus::Running { progress: Some(p) };
            }
            listener(&st.items);
        };
        let result = executor(&job, &ctl, &mut on_progress);

        let done_item = {
            let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
            st.running = None;
            let status = match result {
                Ok(outcome) => ItemStatus::Done { outcome },
                Err(e) if e.kind == ErrorKind::Cancelled => ItemStatus::Cancelled,
                Err(error) => ItemStatus::Failed { error },
            };
            let item = st.items.iter_mut().find(|i| i.id == id).map(|it| {
                it.status = status;
                it.clone()
            });
            listener(&st.items);
            item
        };
        if let Some(item) = done_item {
            finished(&item);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_export::{OutcomeMode, Stage};
    use crate::project::OutputFormat;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn outcome(name: &str) -> ProjectOutcome {
        ProjectOutcome {
            output: name.into(),
            project_file: None,
            mode: OutcomeMode::Precise,
            format: OutputFormat::Mp4,
            encoder: None,
            fell_back: false,
            width: 1,
            height: 1,
            duration: 1.0,
            size_bytes: 1,
            elapsed_secs: 0.1,
            size_retries: 0,
        }
    }

    fn job(name: &str) -> ExportJob {
        let mut p = crate::testutil::sample_project();
        p.name = name.into();
        ExportJob { project: p, settings: None, window: None, output: None, label: None, save_project: false, raster: None }
    }

    /// Ejecutor falso: tarda ~`ms` reportando progreso; respeta la cancelación;
    /// falla si el nombre empieza con "mal".
    fn fake(order: Arc<Mutex<Vec<String>>>, gate: Arc<AtomicBool>, ms: u64) -> Executor {
        Arc::new(move |job, ctl, progress| {
            while !gate.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(2));
            }
            order.lock().unwrap().push(job.project.name.clone());
            for i in 0..10 {
                if ctl.is_cancelled() {
                    return Err(AppError::new(ErrorKind::Cancelled));
                }
                progress(JobProgress { percent: i as f64 * 10.0, speed: None, eta_secs: None, stage: Stage::Encoding });
                std::thread::sleep(Duration::from_millis(ms / 10));
            }
            if job.project.name.starts_with("mal") {
                return Err(AppError::new(ErrorKind::DiskFull));
            }
            Ok(outcome(&job.project.name))
        })
    }

    fn wait_until(q: &ExportQueue, f: impl Fn(&[QueueItem]) -> bool) {
        let t = Instant::now();
        while !f(&q.snapshot()) {
            assert!(t.elapsed() < Duration::from_secs(10), "timeout: {:?}", q.snapshot());
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn runs_one_at_a_time_in_order_with_reorder_cancel_and_failures() {
        let order = Arc::new(Mutex::new(vec![]));
        let gate = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(0usize));
        let ev = events.clone();
        let fin = Arc::new(Mutex::new(vec![]));
        let fin2 = fin.clone();
        let q = ExportQueue::start(
            fake(order.clone(), gate.clone(), 60),
            Arc::new(move |_| *ev.lock().unwrap() += 1),
            Arc::new(move |it: &QueueItem| fin2.lock().unwrap().push(it.title.clone())),
        );
        let a = q.enqueue(job("a"), "A".into());
        let b = q.enqueue(job("b"), "B".into());
        let c = q.enqueue(job("c"), "C".into());
        let d = q.enqueue(job("mal"), "D".into());
        let e = q.enqueue(job("e"), "E".into());
        wait_until(&q, |s| matches!(s[0].status, ItemStatus::Running { .. }));
        // "a" ya arrancó: reordenamos los que esperan (c antes que b) y cancelamos e.
        q.reorder(c, 0);
        q.cancel(e);
        q.cancel(a); // reordenar no toca al que corre; cancelar sí lo frena
        assert!(q.is_busy());
        gate.store(true, Ordering::SeqCst);
        wait_until(&q, |s| s.iter().all(|i| i.status.is_finished()));
        assert_eq!(*order.lock().unwrap(), vec!["a", "c", "b", "mal"]);
        let snap = q.snapshot();
        let st = |id: u64| snap.iter().find(|i| i.id == id).unwrap().status.clone();
        assert_eq!(st(a), ItemStatus::Cancelled);
        assert!(matches!(st(b), ItemStatus::Done { .. }));
        assert!(matches!(st(c), ItemStatus::Done { .. }));
        assert!(matches!(st(d), ItemStatus::Failed { error } if error.kind == ErrorKind::DiskFull));
        assert_eq!(st(e), ItemStatus::Cancelled);
        assert!(*events.lock().unwrap() > 8, "avisa cada cambio");
        assert_eq!(*fin.lock().unwrap(), vec!["A", "C", "B", "D"]);
        assert!(!q.is_busy());
        q.remove_finished(Some(b));
        assert_eq!(q.snapshot().len(), 4);
        q.remove_finished(None);
        assert!(q.snapshot().is_empty());
    }

    #[test]
    fn progress_is_reported_while_running() {
        let gate = Arc::new(AtomicBool::new(true));
        let q = ExportQueue::start(fake(Arc::new(Mutex::new(vec![])), gate, 400), Arc::new(|_| {}), Arc::new(|_| {}));
        q.enqueue(job("x"), "X".into());
        wait_until(&q, |s| matches!(&s[0].status, ItemStatus::Running { progress: Some(p) } if p.percent > 0.0));
        wait_until(&q, |s| s[0].status.is_finished());
    }

    #[test]
    fn status_json_for_the_ui() {
        let v = serde_json::to_value(ItemStatus::Running { progress: None }).unwrap();
        assert_eq!(v["state"], "running");
        let it = QueueItem { id: 3, title: "T".into(), project_id: "p".into(), status: ItemStatus::Queued, job: job("j") };
        let v = serde_json::to_value(&it).unwrap();
        assert_eq!(v["status"]["state"], "queued");
        assert!(v.get("job").is_none(), "el proyecto entero no viaja en cada evento");
    }
}
