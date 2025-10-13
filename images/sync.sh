#!/bin/sh

set +e
_check_legit_pwd=$(git rev-parse --show-toplevel 2>/dev/null)
_check_repo_name=$(git remote get-url origin 2>/dev/null)
set -e
if [ $? -eq 1 ] || [ "$(pwd)" != "$_check_legit_pwd" ] || echo "$_check_repo_name" | grep -vE "dank"  > /dev/null; then
    echo "run from eighty4/dank repo root"
    exit 1
fi

# updates ./create-dank and ./www images

_bacon="./images/bacon.svg"
_egg="./images/egg.svg"

program_check() {
    local _prog="$1"
    local _url="$2"
    if ! command -v "$_prog" &> /dev/null; then
        echo "\033[31merror:\033[0m $_prog is required\n\n  $_url\n"
        exit 1
    fi
}

program_check "inkscape" "https://inkscape.org/release"
program_check "pnpm" "https://pnpm.io/installation"

success() {
    echo "\033[32m✔\033[0m $1"
}

transform_png() {
    local _src="$1"
    local _size="$2"
    local _out="$3"
    local _bg="$4"
    local _scale="$5"
    inkscape --actions="select-all; fit-canvas-to-selection; transform-scale:$_scale; select-all; object-align:hcenter page; object-align:vcenter page" -w "$_size" -h "$_size" --export-background "$_bg" -o "$_out" "$_src"
    success "$_out"
}

export_png() {
    local _src="$1"
    local _size="$2"
    local _out="$3"
    inkscape -w "$_size" -h "$_size" -o "$_out" "$_src"
    success "$_out"
}

export_svg() {
    local _src="$1"
    local _out="$2"
    inkscape -o "$_out" "$_src"
    pnpm dlx -s svgo -q "$_out"
    success "$_out"
}

# create-dank
export_svg $_egg create-dank/assets/public/dank.svg
## chrome, firefox & safari
export_png $_egg 16 create-dank/assets/public/dank-16.png
export_png $_egg 32 create-dank/assets/public/dank-32.png
export_png $_egg 48 create-dank/assets/public/dank-48.png
export_png $_egg 64 create-dank/assets/public/dank-64.png
export_png $_egg 96 create-dank/assets/public/dank-96.png
## android
export_png $_egg 192 create-dank/assets/public/dank-192.png
export_png $_egg 512 create-dank/assets/public/dank-512.png
transform_png $_egg 192 create-dank/assets/public/dank-192-m.png "#ffe" ".6"
transform_png $_egg 512 create-dank/assets/public/dank-512-m.png "#ffe" ".6"
## apple-touch-icon
transform_png $_egg 180 create-dank/assets/public/apple-touch-icon.png "#ffe" ".7"

# www
export_svg $_bacon www/public/bacon.svg
