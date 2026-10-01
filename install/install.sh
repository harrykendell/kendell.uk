#!/usr/bin/env bash
set -euo pipefail

HOST="ssh.kendell.uk"
USER_NAME="harry"
BEGIN_MARKER="# BEGIN kendell-home-ssh"
END_MARKER="# END kendell-home-ssh"

say() {
    printf '\n%s\n' "$*"
}

install_cloudflared() {
    if command -v cloudflared >/dev/null 2>&1; then
        return
    fi

    case "$(uname -s)" in
        Linux)
            if ! command -v apt-get >/dev/null 2>&1; then
                printf 'Automatic cloudflared installation currently supports Debian/Ubuntu Linux.\n' >&2
                exit 1
            fi
            say "Installing cloudflared..."
            sudo apt-get update
            sudo apt-get install -y curl
            sudo install -d -m 0755 /usr/share/keyrings
            curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg                 | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
            printf '%s\n'                 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main'                 | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
            sudo apt-get update
            sudo apt-get install -y cloudflared
            ;;
        Darwin)
            if ! command -v brew >/dev/null 2>&1; then
                printf 'Homebrew is required for automatic cloudflared installation on macOS.\n' >&2
                exit 1
            fi
            say "Installing cloudflared..."
            brew install cloudflared
            ;;
        *)
            printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2
            exit 1
            ;;
    esac
}

configure_ssh() {
    local cloudflared_path="$1"
    local ssh_dir="$HOME/.ssh"
    local config="$ssh_dir/config"
    local temp

    mkdir -p "$ssh_dir"
    chmod 700 "$ssh_dir"
    touch "$config"
    chmod 600 "$config"

    temp="$(mktemp)"
    awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
        $0 == begin { skipping = 1; next }
        $0 == end   { skipping = 0; next }
        !skipping   { print }
    ' "$config" > "$temp"

    cat "$temp" > "$config"
    rm -f "$temp"

    if [ -s "$config" ]; then
        printf '\n' >> "$config"
    fi

    cat >> "$config" <<EOF

$BEGIN_MARKER
Match host $HOST exec "$cloudflared_path access ssh-gen --hostname %h"
    HostName $HOST
    User $USER_NAME
    ProxyCommand $cloudflared_path access ssh --hostname %h
    IdentityFile ~/.cloudflared/%h-cf_key
    CertificateFile ~/.cloudflared/%h-cf_key-cert.pub
    ServerAliveInterval 30
    ServerAliveCountMax 3
$END_MARKER
EOF

    chmod 600 "$config"
}

main() {
    install_cloudflared

    local cloudflared_path
    cloudflared_path="$(command -v cloudflared)"

    say "Configuring SSH access to $HOST..."
    configure_ssh "$cloudflared_path"

    if command -v code >/dev/null 2>&1; then
        say "Installing VS Code Remote - SSH..."
        code --install-extension ms-vscode-remote.remote-ssh >/dev/null
    fi

    say "Configuration complete."
    printf 'The first connection opens Cloudflare Access in your browser.\n'
    printf 'Terminal: ssh %s\n' "$HOST"
    printf 'VS Code:  code --new-window --remote ssh-remote+%s /home/harry/Desktop/thesis\n' "$HOST"

    say "Starting the first SSH connection..."
    exec ssh "$HOST"
}

main "$@"
