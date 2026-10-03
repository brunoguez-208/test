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

/// Nombre de archivo (sin carpeta) de una ruta de Windows o POSIX.
pub fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

/// `nombre.ext`, `nombre (2).ext`… que no esté en `used` (sin distinguir mayúsculas).
pub fn unique_name(name: &str, used: &mut std::collections::HashSet<String>) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 1;
    loop {
        let cand = if n == 1 { name.to_string() } else { format!("{stem} ({n}){ext}") };
        if used.insert(cand.to_lowercase()) {
            return cand;
        }
        n += 1;
    }
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
        out.sort_by_key(|x| std::cmp::Reverse(x.updated_at));
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

    // ------------------------------ Versiones ------------------------------

    fn versions_dir(&self, project_id: &str) -> Result<PathBuf, AppError> {
        Ok(self.root.join("versions").join(safe_id(project_id)?))
    }

    /// Guarda una versión nueva (nunca pisa otra). Las automáticas se recortan a las últimas 20.
    pub fn save_version(&self, p: &Project, name: Option<&str>, auto: bool, thumb: Option<&[u8]>, at: u64) -> Result<VersionInfo, AppError> {
        let dir = self.versions_dir(&p.id)?;
        let mut n = 0;
        let id = loop {
            let id = if n == 0 { format!("v{at}") } else { format!("v{at}-{n}") };
            if !dir.join(format!("{id}.json")).exists() {
                break id;
            }
            n += 1;
        };
        let thumbnail = match thumb {
            Some(j) => {
                let t = dir.join(format!("{id}.jpg"));
                write_atomic(&t, j)?;
                Some(t.to_string_lossy().into_owned())
            }
            None => None,
        };
        let info = VersionInfo {
            id: id.clone(),
            project_id: p.id.clone(),
            name: name.map(str::trim).filter(|s| !s.is_empty()).map(String::from),
            created_at: at,
            auto,
            duration: timeline::total_duration(p),
            clip_count: p.clips.len(),
            thumbnail,
        };
        let body = serde_json::json!({ "info": info, "project": p });
        write_atomic(&dir.join(format!("{id}.json")), &serde_json::to_vec(&body).unwrap_or_default())?;
        if auto {
            let autos: Vec<VersionInfo> = self.list_versions(&p.id).into_iter().filter(|v| v.auto).collect();
            for old in autos.iter().skip(MAX_AUTO_VERSIONS) {
                let _ = std::fs::remove_file(dir.join(format!("{}.json", old.id)));
                let _ = std::fs::remove_file(dir.join(format!("{}.jpg", old.id)));
            }
        }
        Ok(info)
    }

    /// Versiones de un proyecto, de la más nueva a la más vieja.
    pub fn list_versions(&self, project_id: &str) -> Vec<VersionInfo> {
        let Ok(dir) = self.versions_dir(project_id) else { return vec![] };
        let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
        let mut out: Vec<VersionInfo> = rd
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
            .filter_map(|e| {
                let v: serde_json::Value = serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok()?;
                serde_json::from_value(v.get("info")?.clone()).ok()
            })
            .collect();
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        out
    }

    pub fn load_version(&self, project_id: &str, version_id: &str) -> Result<Project, AppError> {
        let path = self.versions_dir(project_id)?.join(format!("{}.json", safe_id(version_id)?));
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(path).map_err(|e| AppError::from_io(&e))?)
            .map_err(|e| AppError::with_detail(ErrorKind::BadProject, e.to_string()))?;
        let text = v.get("project").map(|p| p.to_string()).ok_or_else(|| AppError::new(ErrorKind::BadProject))?;
        migrate::parse(&text)
    }

    // ------------------------------ Plantillas ------------------------------

    fn templates_dir(&self) -> PathBuf {
        self.root.join("templates")
    }

    /// Guarda una plantilla. Los medios que usa (intro, outro, logos) se copian
    /// a la carpeta de la plantilla, así sigue andando aunque se muevan.
    pub fn save_template(&self, name: &str, summary: &str, mut data: serde_json::Value, thumb: Option<&[u8]>, at: u64) -> Result<TemplateInfo, AppError> {
        let id = format!("t{at}");
        let dir = self.templates_dir().join(&id);
        std::fs::create_dir_all(&dir).map_err(|e| AppError::from_io(&e))?;
        if let Some(media) = data.get_mut("media").and_then(|m| m.as_array_mut()) {
            let mut used = std::collections::HashSet::new();
            for m in media.iter_mut() {
                let Some(src) = m.get("path").and_then(|p| p.as_str()).map(String::from) else { continue };
                let src_path = Path::new(&src);
                if !src_path.is_file() {
                    return Err(AppError::with_message(ErrorKind::MediaMissing, format!("No se encontró {}", file_name(&src))));
                }
                let dest = dir.join(unique_name(&file_name(&src), &mut used));
                std::fs::copy(src_path, &dest).map_err(|e| AppError::from_io(&e))?;
                m["path"] = serde_json::Value::String(dest.to_string_lossy().into_owned());
            }
        }
        let thumbnail = match thumb {
            Some(j) => {
                let t = dir.join("miniatura.jpg");
                write_atomic(&t, j)?;
                Some(t.to_string_lossy().into_owned())
            }
            None => None,
        };
        let info = TemplateInfo { id: id.clone(), name: name.trim().to_string(), created_at: at, thumbnail, summary: summary.to_string() };
        let body = serde_json::json!({ "info": info, "data": data });
        write_atomic(&dir.join("plantilla.json"), &serde_json::to_vec_pretty(&body).unwrap_or_default())?;
        Ok(info)
    }

    pub fn list_templates(&self) -> Vec<TemplateInfo> {
        let Ok(rd) = std::fs::read_dir(self.templates_dir()) else { return vec![] };
        let mut out: Vec<TemplateInfo> = rd
            .flatten()
            .filter_map(|e| {
                let v: serde_json::Value = serde_json::from_slice(&std::fs::read(e.path().join("plantilla.json")).ok()?).ok()?;
                serde_json::from_value(v.get("info")?.clone()).ok()
            })
            .collect();
        out.sort_by_key(|t| std::cmp::Reverse(t.created_at));
        out
    }

    pub fn load_template(&self, id: &str) -> Result<serde_json::Value, AppError> {
        let path = self.templates_dir().join(safe_id(id)?).join("plantilla.json");
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(path).map_err(|e| AppError::from_io(&e))?)
            .map_err(|e| AppError::with_detail(ErrorKind::BadProject, e.to_string()))?;
        v.get("data").cloned().ok_or_else(|| AppError::new(ErrorKind::BadProject))
    }

    pub fn delete_template(&self, id: &str) -> Result<(), AppError> {
        let dir = self.templates_dir().join(safe_id(id)?);
        std::fs::remove_dir_all(dir).map_err(|e| AppError::from_io(&e))
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

/// Abre un `.snip`: migra y devuelve también qué archivos faltan. Las rutas
/// relativas (proyectos empaquetados) se resuelven desde la carpeta del `.snip`.
pub fn open_snip(path: &Path) -> Result<(Project, Vec<String>), AppError> {
    let text = std::fs::read_to_string(path).map_err(|e| AppError::from_io(&e))?;
    let mut p = migrate::parse(&text)?;
    if let Some(dir) = path.parent() {
        for m in &mut p.media {
            if is_relative_media(&m.path) {
                m.path = dir.join(m.path.replace('\\', "/")).to_string_lossy().into_owned();
            }
        }
    }
    let missing = missing_media(&p);
    Ok((p, missing))
}

/// ¿Ruta relativa? (ni `C:\…`, ni `\\servidor\…`, ni `/…`).
pub fn is_relative_media(path: &str) -> bool {
    let b = path.as_bytes();
    let drive = b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':';
    !(path.is_empty() || drive || path.starts_with('\\') || path.starts_with('/'))
}

// ---------------------------------- Versiones ----------------------------------

/// Una versión guardada de un proyecto (manual o automática al exportar).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub project_id: String,
    pub name: Option<String>,
    pub created_at: u64,
    /// Automática (al exportar) o guardada a mano.
    pub auto: bool,
    pub duration: f64,
    pub clip_count: usize,
    pub thumbnail: Option<String>,
}

/// Versiones automáticas que se conservan por proyecto (las manuales, todas).
pub const MAX_AUTO_VERSIONS: usize = 20;

// --------------------------------- Plantillas ---------------------------------

/// Plantilla ("Guardar como plantilla"): intro, outro, estilos de texto y
/// preset de exportación. `data` lo arma el frontend; acá se guarda tal cual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub summary: String,
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

    #[test]
    fn versions_never_overwrite_and_restore() {
        let dir = tempfile::tempdir().unwrap();
        let st = Store::new(dir.path());
        let mut p = sample_project();
        p.id = "proj".into();
        let a = st.save_version(&p, Some("Antes del color"), false, Some(&[0xFF, 0xD8]), 100).unwrap();
        p.name = "Cambiado".into();
        let b = st.save_version(&p, None, true, None, 100).unwrap();
        assert_ne!(a.id, b.id, "mismo instante: no se pisa");
        let list = st.list_versions("proj");
        assert_eq!(list.len(), 2);
        assert_eq!(list.iter().filter(|v| v.auto).count(), 1);
        let named = list.iter().find(|v| !v.auto).unwrap();
        assert_eq!(named.name.as_deref(), Some("Antes del color"));
        assert!(named.thumbnail.as_deref().is_some_and(|t| Path::new(t).is_file()));
        assert_ne!(st.load_version("proj", &a.id).unwrap().name, "Cambiado");
        assert_eq!(st.load_version("proj", &b.id).unwrap().name, "Cambiado");
        // Las automáticas se recortan; las manuales quedan.
        for i in 0..(MAX_AUTO_VERSIONS + 5) {
            st.save_version(&p, None, true, None, 200 + i as u64).unwrap();
        }
        let list = st.list_versions("proj");
        assert_eq!(list.iter().filter(|v| v.auto).count(), MAX_AUTO_VERSIONS);
        assert!(list.iter().any(|v| v.id == a.id));
        assert!(st.load_version("proj", "../x").is_err());
    }

    #[test]
    fn templates_copy_their_media() {
        let dir = tempfile::tempdir().unwrap();
        let st = Store::new(dir.path().join("data"));
        let intro = dir.path().join("intro.mp4");
        std::fs::write(&intro, b"intro").unwrap();
        let data = serde_json::json!({ "media": [{ "id": "m1", "path": intro.to_string_lossy() }], "export": { "format": "mp4" } });
        let t = st.save_template("Canal", "intro + títulos", data, None, 5).unwrap();
        std::fs::remove_file(&intro).unwrap();
        let list = st.list_templates();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Canal");
        let back = st.load_template(&t.id).unwrap();
        let path = back["media"][0]["path"].as_str().unwrap();
        assert!(Path::new(path).is_file(), "la plantilla tiene su copia: {path}");
        st.delete_template(&t.id).unwrap();
        assert!(st.list_templates().is_empty());
    }
}