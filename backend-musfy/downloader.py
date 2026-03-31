import sys
import os
import json
import re
import yt_dlp


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def sanitize_component(value, fallback="audio"):
    value = str(value or "").strip()
    if not value:
        return fallback

    replacements = {
        "\u201c": '"',
        "\u201d": '"',
        "\u2018": "'",
        "\u2019": "'",
        "\u2013": "-",
        "\u2014": "-",
        "\u2026": "...",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)

    value = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"\s+", " ", value).strip()
    value = value.rstrip(" .")

    return value or fallback


def main():
    if len(sys.argv) < 3:
        emit({
            "success": False,
            "error": "Uso: python downloader.py <url> <output_dir>"
        })
        sys.exit(1)

    url = sys.argv[1]
    output_dir = sys.argv[2]

    os.makedirs(output_dir, exist_ok=True)

    downloaded_items = []

    def progress_hook(d):
        status = d.get("status")

        if status == "downloading":
            emit({
                "type": "progress",
                "status": "downloading",
                "filename": d.get("filename"),
                "percent": str(d.get("_percent_str", "")).strip(),
                "speed": str(d.get("_speed_str", "")).strip(),
                "eta": str(d.get("_eta_str", "")).strip(),
            })

        elif status == "finished":
            emit({
                "type": "progress",
                "status": "finished",
                "filename": d.get("filename"),
            })

    class Logger:
        def debug(self, msg):
            if not msg:
                return
            emit({
                "type": "log",
                "level": "debug",
                "message": str(msg)
            })

        def warning(self, msg):
            if not msg:
                return
            emit({
                "type": "log",
                "level": "warning",
                "message": str(msg)
            })

        def error(self, msg):
            if not msg:
                return
            emit({
                "type": "log",
                "level": "error",
                "message": str(msg)
            })

    def outtmpl_callback(info):
        playlist_title = sanitize_component(info.get("playlist_title"), "playlist")
        title = sanitize_component(info.get("title"), "audio")
        return os.path.join(output_dir, playlist_title, f"{title}.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "noplaylist": False,
        "ignoreerrors": True,
        "continuedl": True,
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 5,
        "concurrent_fragment_downloads": 4,
        "socket_timeout": 30,
        "windowsfilenames": True,
        "restrictfilenames": True,
        "js_runtimes": {
            "node": {
                "path": "node"
            }
        },
        "remote_components": ["ejs:github"],
        "extractor_args": {
            "youtube": {
                "player_client": ["default", "android"]
            }
        },
        "outtmpl": {
            "default": outtmpl_callback
        },
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "progress_hooks": [progress_hook],
        "logger": Logger(),
    }

    cookies_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
    if os.path.exists(cookies_path):
        ydl_opts["cookiefile"] = cookies_path
        emit({
            "type": "log",
            "level": "info",
            "message": f"Usando cookies: {cookies_path}"
        })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        if info is None:
            emit({
                "success": False,
                "error": "Nenhuma informação foi retornada pelo yt_dlp"
            })
            sys.exit(1)

        if "entries" in info:
            for entry in info.get("entries", []):
                if not entry:
                    continue

                title = entry.get("title")
                webpage_url = entry.get("webpage_url") or entry.get("original_url")
                requested_downloads = entry.get("requested_downloads") or []

                final_path = None
                if requested_downloads and isinstance(requested_downloads, list):
                    final_path = requested_downloads[0].get("filepath")

                if not final_path:
                    playlist_title = sanitize_component(info.get("title"), "playlist")
                    safe_title = sanitize_component(title, "audio")
                    candidate_mp3 = os.path.join(output_dir, playlist_title, f"{safe_title}.mp3")
                    candidate_orig = None
                    ext = entry.get("ext")
                    if ext:
                        candidate_orig = os.path.join(output_dir, playlist_title, f"{safe_title}.{ext}")

                    if os.path.exists(candidate_mp3):
                        final_path = candidate_mp3
                    elif candidate_orig and os.path.exists(candidate_orig):
                        final_path = candidate_orig

                downloaded_items.append({
                    "title": title,
                    "url": webpage_url,
                    "path": final_path
                })
        else:
            requested_downloads = info.get("requested_downloads") or []
            final_path = None

            if requested_downloads and isinstance(requested_downloads, list):
                final_path = requested_downloads[0].get("filepath")

            if not final_path:
                safe_title = sanitize_component(info.get("title"), "audio")
                candidate_mp3 = os.path.join(output_dir, "playlist", f"{safe_title}.mp3")
                if os.path.exists(candidate_mp3):
                    final_path = candidate_mp3

            downloaded_items.append({
                "title": info.get("title"),
                "url": info.get("webpage_url") or info.get("original_url"),
                "path": final_path
            })

        emit({
            "success": True,
            "items": downloaded_items
        })

    except yt_dlp.utils.DownloadError as e:
        emit({
            "success": False,
            "error": str(e)
        })
        sys.exit(1)

    except Exception as e:
        emit({
            "success": False,
            "error": str(e)
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
