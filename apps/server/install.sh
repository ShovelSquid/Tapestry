#!/bin/sh
# Build tapestry-server and run it as a user service: it starts at boot (with
# lingering on) and comes back if it falls over. Run again to update it.
set -e
cd "$(dirname "$0")/../.."
cargo build --release -p tapestry-server
mkdir -p ~/.local/bin ~/.config/systemd/user
# Install beside the running one, then swap, so a rebuild never pulls the
# binary out from under it.
install -m 755 target/release/tapestry-server ~/.local/bin/tapestry-server.new
mv ~/.local/bin/tapestry-server.new ~/.local/bin/tapestry-server
cp apps/server/tapestry-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable tapestry-server
systemctl --user restart tapestry-server
systemctl --user --no-pager status tapestry-server | head -5
