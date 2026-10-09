# tapestry-server

Terminals and Claude Code sessions that outlive the app, open from any of your devices.

- **They keep running.** A terminal opened here runs in the server, not in a window. Closing the browser tab, the phone or the app doesn't end it; only **close** does.
- **They come back.** After a restart or reboot, every terminal reopens in the folder it was in, and Claude sessions reopen with `claude --resume`.
- **Reopen a Claude session.** The page lists your recent Claude Code sessions from every project, titled by the first thing you asked. **reopen** opens one in its folder. A session that's open somewhere else right now is marked *running*.
- **The app shares them.** The canvas app finds the server by itself (here, or as `tapestry-server` on Tailscale), and its terminal cards are the server's terminals. A terminal opened on the phone gets a card in the app, and closing one anywhere closes it everywhere. Closing the app leaves them running. `TAPESTRY_SERVER=off` keeps the app's terminals to itself.
- **Notes.** The page shows and edits the app's notes: the `.md` files in `world/notes/`, which the app tells the server about. They stay ordinary files, so an edit on the phone is in the app half a second later.
- **Any device.** The page at `http://tapestry-server:7878` (or `http://100.100.99.119:7878`) works on a phone too, with a key bar for esc, tab, ctrl, arrows and ^C.

## Who can reach it

It listens only on this machine (`127.0.0.1`) and its Tailscale address, so only devices signed in to your Tailscale account reach it. It answers only to its own host names, and changes (opening, typing, closing) must come from its own page. That way a website open in your browser can't reach it through `localhost`.

## Running it

```
apps/server/install.sh                      # build, install to ~/.local/bin, (re)start the user service
systemctl --user status tapestry-server
journalctl --user -u tapestry-server -f
```

The service starts at boot, without logging in, because lingering is on (`loginctl enable-linger`). State is kept in `~/.local/state/tapestry/server/sessions.json`. For a trial run beside the real one, use `XDG_STATE_HOME=/some/dir cargo run -p tapestry-server -- --port 7979`.

## Not yet

- Every window on a terminal shares one size. The last one to resize sets it, so a phone and the app's card take turns.
- An app on another computer shares the terminals, but not that computer's notes.
- Scrollback from before you attached isn't sent, only the screen as it is now.
