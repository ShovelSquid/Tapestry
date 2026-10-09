#!/bin/sh
# Build tapestry-server and keep it running: a systemd user service on Linux
# (it starts at boot, with lingering on), a launchd agent on macOS (it starts
# when you log in). Either way it comes back if it falls over. Run again to
# update it.
set -e
cd "$(dirname "$0")/../.."
cargo build --release -p tapestry-server
mkdir -p ~/.local/bin
# Install beside the running one, then swap, so a rebuild never pulls the
# binary out from under it.
install -m 755 target/release/tapestry-server ~/.local/bin/tapestry-server.new
mv ~/.local/bin/tapestry-server.new ~/.local/bin/tapestry-server

case "$(uname)" in
Darwin)
    agent=~/Library/LaunchAgents/com.tapestry.server.plist
    mkdir -p ~/Library/LaunchAgents ~/Library/Logs
    cat > "$agent" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tapestry.server</string>
    <key>ProgramArguments</key><array><string>$HOME/.local/bin/tapestry-server</string></array>
    <key>EnvironmentVariables</key><dict>
        <key>PATH</key><string>$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>SHELL</key><string>${SHELL:-/bin/zsh}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardErrorPath</key><string>$HOME/Library/Logs/tapestry-server.log</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/com.tapestry.server" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$agent"
    sleep 1
    launchctl print "gui/$(id -u)/com.tapestry.server" | grep -E "^\s+state" || true
    echo "logs: ~/Library/Logs/tapestry-server.log"
    ;;
*)
    mkdir -p ~/.config/systemd/user
    cp apps/server/tapestry-server.service ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable tapestry-server
    systemctl --user restart tapestry-server
    systemctl --user --no-pager status tapestry-server | head -5
    ;;
esac
