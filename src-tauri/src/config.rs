use std::{fs, path::PathBuf};

fn config_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA").ok_or("APPDATA is unavailable")?;
        return Ok(PathBuf::from(appdata).join("Hyperact").join("config.json"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var_os("HOME").ok_or("HOME is unavailable")?;
        Ok(PathBuf::from(home)
            .join(".config")
            .join("Hyperact")
            .join("config.json"))
    }
}

#[tauri::command]
pub fn load_config() -> Result<String, String> {
    let path = config_path()?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn save_config(json: String) -> Result<(), String> {
    let path = config_path()?;
    let directory = path.parent().ok_or("Invalid config path")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}
