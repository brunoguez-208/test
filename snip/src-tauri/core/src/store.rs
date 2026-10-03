//! Almacenamiento en la carpeta de datos de la app: autoguardado de proyectos
//! ("Proyectos sin terminar"), miniaturas, archivos recientes y `.snip`.

use crate::error::{AppError, ErrorKind};
use crate::migrate;
use crate::project::Project;
use crate::timeline;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_RECENT: usize = 12;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub duration: f64,
    pub updated_at: u64,
    pub clip_count: usize,
    /// Miniatura (JPEG) si existe.
    pub thumbnail: Option<String>,
    /// `.snip` asociado (si se guardó con Ctrl+S).
    pub file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    /// "video" o "project".
    pub kind: String,
    pub opened_at: u64,
}

pub struct Store {
    root: PathBuf,
}

/// Escritura atómica: primero a un temporal y después se renombra.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::from_io(&e))?;
    }
    let tmp = path.with_extension("tmp-write");
    std::fs::write(&tmp, data).map_err(|e| AppError::from_io(&e))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::from_io(&e)
    })
}

fn safe_id(id: &str) -> Result<&str, AppError> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(id)
    } else {
        Err(AppError::with_message(ErrorKind::BadProject, "Identificador de proyecto inválido."))
    }
}

/// Metadatos de un autoguardado: el `.snip` asociado (si hay).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    #[serde(default)]
    file: Option<String>,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let _ = std::fs::create_dir_all(root.join("projects"));
        Self { root }
    }

    fn json(&self, id: &str) -> PathBuf {
        self.root.join("projects").join(format!("{id}.json"))
    }
    fn meta(&self, id: &str) -> PathBuf {
        self.root.join("projects").join(format!("{id}.meta.json"))
    }
    pub fn thumb_path(&self, id: &str) -> PathBuf {
        self.root.join("projects").join(format!("{id}.jpg"))
    }

    /// Autoguarda el proyecto (y el `.snip` asociado, si se pasa).
    pub fn autosave(&self, p: &Project, file: Option<&str>) -> Result<(), AppError> {
        let id = safe_id(&p.id)?;
        let text = serde_json::to_vec(p).map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
        write_atomic(&self.json(id), &text)?;
        if let Some(f) = file {
            let meta = serde_json::to_vec(&Meta { file: Some(f.to_string()) }).unwrap_or_default();
            write_atomic(&self.meta(id), &meta)?;
        }
        Ok(())
    }

    pub fn save_thumbnail(&self, id: &str, jpeg: &[u8]) -> Result<(), AppError> {
        write_atomic(&self.thumb_path(safe_id(id)?), jpeg)
    }

    pub fn load(&self, id: &str) -> Result<Project, AppError> {
        let text = std::fs::read_to_string(self.json(safe_id(id)?)).map_err(|e| AppError::from_io(&e))?;
        migrate::parse(&text)
    }

    fn read_meta(&self, id: &str) -> Meta {
        std::fs::read(self.meta(id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    /// Proyectos que todavía no se exportaron, del más reciente al más viejo.
    pub fn unfinished(&self) -> Vec<ProjectSummary> {
        let Ok(dir) = std::fs::read_dir(self.root.join("projects")) else { return vec![] };
        let mut out: Vec<ProjectSummary> = dir
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let id = name.strip_suffix(".json").filter(|s| !s.ends_with(".meta"))?.to_string();
                let p = self.load(&id).ok()?;
                if p.exported_at.is_some() || p.clips.is_empty() {
                    return None;
                }
                let thumb = self.thumb_path(&id);
                Some(ProjectSummary {
                    duration: timeline::total_duration(&p),
                    clip_count: p.clips.len(),
                    name: p.name.clone(),
                    updated_at: p.updated_at,
                    thumbnail: thumb.is_file().then(|| thumb.to_string_lossy().into_owned()),
                    file: self.read_meta(&id).file,
                    id,
                })
            })
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    /// Marca como exportado (desaparece de "sin terminar").
    pub fn mark_exported(&self, id: &str, at: u64) -> Result<(), AppError> {
        let mut p = match self.load(id) {
            Ok(p) => p,
            Err(_) => return Ok(()),
        };
        p.exported_at = Some(at);
        let file = self.read_meta(id).file;
        self.autosave(&p, file.as_deref())
    }

    pub fn discard(&self, id: &str) -> Result<(), AppError> {
        let id = safe_id(id)?;
        for p in [self.json(id), self.meta(id), self.thumb_path(id)] {
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    }

    fn recent_path(&self) -> PathBuf {
        self.root.join("recent.json")
    }

    pub fn recent(&self) -> Vec<RecentFile> {
        let list: Vec<RecentFile> = std::fs::read(self.recent_path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        list.into_iter().filter(|r| Path::new(&r.path).is_file()).collect()
    }

    pub fn add_recent(&self, path: &str, kind: &str, at: u64) -> Result<(), AppError> {
        let mut list = self.recent();
        let norm = |s: &str| s.replace('\\', "/").to_lowercase();
        list.retain(|r| norm(&r.path) != norm(path));
        list.insert(0, RecentFile { path: path.to_string(), kind: kind.to_string(), opened_at: at });
        list.truncate(MAX_RECENT);
        let bytes = serde_json::to_vec(&list).map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
        write_atomic(&self.recent_path(), &bytes)
    }

    pub fn remove_recent(&self, path: &str) -> Result<(), AppError> {
        let mut list = self.recent();
        list.retain(|r| r.path != path);
        let bytes = serde_json::to_vec(&list).unwrap_or_default();
        write_atomic(&self.recent_path(), &bytes)
    }
}

/// Guarda un `.snip` (JSON legible).
pub fn save_snip(path: &Path, p: &Project) -> Result<(), AppError> {
    let text = serde_json::to_string_pretty(p).map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
    write_atomic(path, text.as_bytes())
}

/// Abre un `.snip`: migra y devuelve también qué archivos faltan.
pub fn open_snip(path: &Path) -> Result<(Project, Vec<String>), AppError> {
    let text = std::fs::read_to_string(path).map_err(|e| AppError::from_io(&e))?;
    let p = migrate::parse(&text)?;
    let missing = missing_media(&p);
    Ok((p, missing))
}

/// Ids de los medios cuyo archivo ya no está.
pub fn missing_media(p: &Project) -> Vec<String> {
    p.media.iter().filter(|m| !Path::new(&m.path).is_file()).map(|m| m.id.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::sample_project;

    #[test]
    fn autosave_list_mark_exported_and_discard() {
        let dir = tempfile::tempdir().unwrap();
        let st = Store::new(dir.path());
        let mut a = sample_project();
        a.id = "aaa".into();
        a.updated_at = 10;
        let mut b = sample_project();
        b.id = "bbb".into();
        b.name = "Segundo".into();
        b.updated_at = 20;
        st.autosave(&a, None).unwrap();
        st.autosave(&b, Some("C:\\x\\b.snip")).unwrap();
        st.save_thumbnail("bbb", &[0xFF, 0xD8, 0xFF]).unwrap();
        let list = st.unfinished();
        assert_eq!(list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["bbb", "aaa"]);
        assert_eq!(list[0].name, "Segundo");
        assert!(list[0].thumbnail.is_some() && list[1].thumbnail.is_none());
        assert_eq!(list[0].file.as_deref(), Some("C:\\x\\b.snip"));
        assert!(list[0].duration > 0.0);
        assert_eq!(st.load("aaa").unwrap(), a);

        st.mark_exported("bbb", 99).unwrap();
        assert_eq!(st.unfinished().len(), 1);
        st.discard("aaa").unwrap();
        assert!(st.unfinished().is_empty());
        assert!(st.load("../etc/passwd").is_err(), "ids con rutas se rechazan");
    }

    #[test]
    fn recent_files_dedupe_and_skip_missing() {
        let dir = tempfile::tempdir().unwrap();
        let st = Store::new(dir.path().join("data"));
        let f1 = dir.path().join("uno.mp4");
        let f2 = dir.path().join("dos.snip");
        std::fs::write(&f1, b"x").unwrap();
        std::fs::write(&f2, b"x").unwrap();
        let s1 = f1.to_string_lossy().into_owned();
        let s2 = f2.to_string_lossy().into_owned();
        st.add_recent(&s1, "video", 1).unwrap();
        st.add_recent(&s2, "project", 2).unwrap();
        st.add_recent(&s1, "video", 3).unwrap();
        st.add_recent("/no/existe.mp4", "video", 4).unwrap();
        let r = st.recent();
        assert_eq!(r.iter().map(|x| x.path.clone()).collect::<Vec<_>>(), vec![s1.clone(), s2.clone()]);
        st.remove_recent(&s1).unwrap();
        assert_eq!(st.recent().len(), 1);
    }

    #[test]
    fn snip_files_roundtrip_and_report_missing_media() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = sample_project();
        let real = dir.path().join("a.mp4");
        std::fs::write(&real, b"x").unwrap();
        p.media[0].path = real.to_string_lossy().into_owned();
        let f = dir.path().join("proyecto.snip");
        save_snip(&f, &p).unwrap();
        let (back, missing) = open_snip(&f).unwrap();
        assert_eq!(back, p);
        assert_eq!(missing, vec!["m2".to_string(), "m3".to_string()]);
        std::fs::write(&f, "{").unwrap();
        assert_eq!(open_snip(&f).unwrap_err().kind, ErrorKind::BadProject);
    }
}
