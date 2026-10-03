// Atajos para los tests de Playwright (solo en el build "mock"): editar el
// proyecto como lo haría el inspector y elegir elementos sin depender del layout.

import type { Project } from "../project/model";
import { activeProject, edit, setSelection } from "../store/editor";
import { addText } from "../project/overlayOps";

export interface TestApi {
  project(): Project | null;
  edit(f: (p: Project) => Project): void;
  editJson(patch: string): void;
  addText(at: number): string;
  select(ids: string[]): void;
  selectAll(kind: "clips" | "overlays" | "music"): void;
}

export function installTestApi() {
  const api: TestApi = {
    project: () => activeProject(),
    edit: (f) => edit(f),
    // Para page.evaluate: una función serializada que recibe el proyecto.
    editJson: (src) => edit((p) => (new Function("p", `return (${src})(p)`) as (p: Project) => Project)(p)),
    addText: (at) => {
      let id = "";
      edit((p) => {
        const [r, n] = addText(p, "title", at);
        id = n;
        return r;
      });
      return id;
    },
    select: (ids) => setSelection(ids),
    selectAll: (kind) => {
      const p = activeProject();
      if (p) setSelection(p[kind].map((x) => x.id));
    },
  };
  window.__snipTest = api;
}

declare global {
  interface Window {
    __snipTest: TestApi;
  }
}
