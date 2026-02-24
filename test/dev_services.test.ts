import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import type { DevService } from '../lib/dank.ts'
import { DevServices, parseCommand } from '../lib/services.ts'

const COMMAND = {
    SERVICE: `node -e "import { createServer } from 'node:http';const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' });res.end('Hello World!');});server.listen(0, '127.0.0.1', () => {console.log('started');})"`,
} as const

suite('Dev services', () => {
    suite('services.ts', () => {
        test('ctor starts a configured process', () => {
            const configured: Array<DevService> = [
                {
                    command: COMMAND.SERVICE,
                    http: {
                        port: 8675,
                    },
                },
            ]
            const services = new DevServices(configured)
            const runningHttp = services.httpServices
            assert.equal(runningHttp.length, 1)
            assert.equal(runningHttp[0].port, 8675)
            services.shutdown()
        })

        test('updates adds a new service', () => {
            const controller = new AbortController()
            const services = new DevServices([])
            assert.equal(services.httpServices.length, 0)
            const configured: Array<DevService> = [
                {
                    command: COMMAND.SERVICE,
                    http: {
                        port: 8675,
                    },
                },
            ]
            services.update(configured)
            const runningHttp = services.httpServices
            assert.equal(runningHttp.length, 1)
            assert.equal(runningHttp[0].port, 8675)
            services.shutdown()
        })
    })
    suite('parseArgs', () => {
        test('empty args', () => {
            assert.deepEqual(parseCommand('ls'), { path: 'ls', args: [] })
            assert.deepEqual(parseCommand('ls   '), { path: 'ls', args: [] })
        })
        test('space delimited args', () => {
            assert.deepEqual(parseCommand('ls -latr'), {
                path: 'ls',
                args: ['-latr'],
            })
            assert.deepEqual(parseCommand('ls -l -a'), {
                path: 'ls',
                args: ['-l', '-a'],
            })
            assert.deepEqual(parseCommand('ls -l   -a'), {
                path: 'ls',
                args: ['-l', '-a'],
            })
        })
        test('backslash escaped space', () => {
            assert.deepEqual(parseCommand('gomommy-cli --mode=admin\\ user'), {
                path: 'gomommy-cli',
                args: ['--mode=admin\\ user'],
            })
        })
        test('standalone string literal', () => {
            assert.deepEqual(
                parseCommand(`gomommy-cli --dev "admin user" --port 8080`),
                {
                    path: 'gomommy-cli',
                    args: ['--dev', 'admin user', '--port', '8080'],
                },
            )
            assert.deepEqual(parseCommand(`gomommy-cli 'admin user'`), {
                path: 'gomommy-cli',
                args: ['admin user'],
            })
        })
    })
})
