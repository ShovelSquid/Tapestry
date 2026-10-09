//! What runs in a terminal, asked of the system: every process's parent and
//! name, and a process's folder. Linux answers from `/proc`; macOS (and other
//! Unixes) through `ps` and `lsof`.

use std::path::PathBuf;

pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    /// The program's file name: `claude`, `bash`…
    pub name: String,
}

#[cfg(target_os = "linux")]
pub fn all() -> Vec<Proc> {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            // The name is in parentheses and may hold spaces; fields follow the last ')'.
            let rest = &stat[stat.rfind(')')? + 2..];
            let ppid = rest.split(' ').nth(1)?.parse().ok()?;
            // argv[0], not the kernel's 15-letter name: `claude` may be a script.
            let cmd = std::fs::read(e.path().join("cmdline")).unwrap_or_default();
            let argv0 = cmd.split(|&b| b == 0).next().unwrap_or_default();
            Some(Proc {
                pid,
                ppid,
                name: base(&String::from_utf8_lossy(argv0)),
            })
        })
        .collect()
}

#[cfg(not(target_os = "linux"))]
pub fn all() -> Vec<Proc> {
    let Ok(out) = std::process::Command::new("ps").args(["-axo", "pid=,ppid=,comm="]).output() else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut words = l.split_whitespace();
            let pid = words.next()?.parse().ok()?;
            let ppid = words.next()?.parse().ok()?;
            let comm = words.collect::<Vec<_>>().join(" ");
            Some(Proc { pid, ppid, name: base(&comm) })
        })
        .collect()
}

#[cfg(target_os = "linux")]
pub fn cwd(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[cfg(not(target_os = "linux"))]
pub fn cwd(pid: u32) -> Option<PathBuf> {
    let out = std::process::Command::new("lsof")
        .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|l| l.strip_prefix('n'))
        .map(PathBuf::from)
}

/// Whether process `pid` is still running.
pub fn alive(pid: u32) -> bool {
    // Signal 0 checks without sending anything.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

/// `pid` and everything it started, and everything those started.
pub fn descendants(root: u32, procs: &[Proc]) -> Vec<u32> {
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let p = out[i];
        out.extend(procs.iter().filter(|c| c.ppid == p).map(|c| c.pid));
        i += 1;
    }
    out
}

fn base(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).trim_start_matches('-').to_owned()
}
