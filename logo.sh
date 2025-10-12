#!/bin/sh
set -e

# updates create-dank images from the ./logo.svg source

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
    local _size="$1"
    local _out="$2"
    local _bg="$3"
    local _scale="$4"
    inkscape --actions="select-all; fit-canvas-to-selection; transform-scale:$_scale; select-all; object-align:hcenter page; object-align:vcenter page" -w "$_size" -h "$_size" --export-background "$_bg" -o "$_out" logo.svg
    success "$_out"
}

export_png() {
    local _size="$1"
    local _out="$2"
    inkscape -w "$_size" -h "$_size" -o "$_out" ./logo.svg
    success "$_out"
}

export_svg() {
    local _out="$1"
    inkscape -o "$_out" ./logo.svg
    pnpm dlx -s svgo -q "$_out"
    success "$_out"
}

# create-dank assets
export_svg create-dank/assets/public/dank.svg
## chrome, firefox & safari
export_png 16 create-dank/assets/public/dank-16.png
export_png 32 create-dank/assets/public/dank-32.png
export_png 48 create-dank/assets/public/dank-48.png
export_png 64 create-dank/assets/public/dank-64.png
export_png 96 create-dank/assets/public/dank-96.png
## android
export_png 192 create-dank/assets/public/dank-192.png
export_png 512 create-dank/assets/public/dank-512.png
transform_png 192 create-dank/assets/public/dank-192-m.png "#ffe" ".6"
transform_png 512 create-dank/assets/public/dank-512-m.png "#ffe" ".6"
## apple-touch-icon
transform_png 180 create-dank/assets/public/apple-touch-icon.png "#ffe" ".7"
