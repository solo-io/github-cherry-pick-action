// Entry point bundled by ncc into dist/index.js. It is kept separate from
// index.ts so tests can import run() without starting the action.
import {run} from './index'

run()
