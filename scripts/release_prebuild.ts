#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const projectDir = resolve(join(import.meta.dirname, '..'))
const cleanDirs = ['client/build', 'lib_js'].map(p => join(projectDir, p))

await Promise.all(cleanDirs.map(p => rm(p, { force: true, recursive: true })))
