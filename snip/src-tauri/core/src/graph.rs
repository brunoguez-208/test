//! Ayudas para armar un `filter_complex` y la lista de inputs.

pub fn s(v: &str) -> String {
    v.to_string()
}

pub struct Graph {
    pub chains: Vec<String>,
    n: usize,
}

impl Default for Graph {
    fn default() -> Self {
        Self::new()
    }
}

impl Graph {
    pub fn new() -> Self {
        Self { chains: vec![], n: 0 }
    }
    pub fn label(&mut self, prefix: &str) -> String {
        self.n += 1;
        format!("{prefix}{}", self.n)
    }
    /// `[ins]filtro[out]`
    pub fn add(&mut self, ins: &[&str], filter: &str, out: &str) {
        let ins: String = ins.iter().map(|i| format!("[{i}]")).collect();
        self.chains.push(format!("{ins}{filter}[{out}]"));
    }
    pub fn source(&mut self, filter: &str, out: &str) {
        self.chains.push(format!("{filter}[{out}]"));
    }
    /// Descarta un stream que sobra.
    pub fn sink(&mut self, label: &str) {
        self.chains.push(format!("[{label}]anullsink"));
    }
    pub fn build(self) -> String {
        self.chains.join(";")
    }
}

pub struct Inputs {
    pub list: Vec<Vec<String>>,
}

impl Default for Inputs {
    fn default() -> Self {
        Self::new()
    }
}

impl Inputs {
    pub fn new() -> Self {
        Self { list: vec![] }
    }

    /// Agrega un input y devuelve su índice.
    pub fn add(&mut self, mut pre: Vec<String>, path: &str) -> usize {
        pre.push(s("-i"));
        pre.push(path.to_string());
        self.list.push(pre);
        self.list.len() - 1
    }
}

