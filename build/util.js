"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondAndLog = exports.processInput = exports.createFunctionFiles = exports.getRunningContainerID = exports.removeRoute = exports.createFunction = exports.getContainerInfo = void 0;
const stream_1 = __importDefault(require("stream"));
const fs_1 = require("fs");
const util_1 = require("util");
const got_1 = __importDefault(require("got"));
const execa_1 = __importDefault(require("execa"));
const pipeline = util_1.promisify(stream_1.default.pipeline);
const writeFilePromise = util_1.promisify(fs_1.writeFile);
const mkdirPromise = util_1.promisify(fs_1.mkdir);
async function getContainerInfo() {
    const { stdout } = await execa_1.default.command('docker ps --format "{{.Ports}}@@{{.Names}}" --filter "status=running"', {
        shell: true,
    });
    const containerInfo = stdout
        .split("\n")
        .filter((e) => /^0\.0\.0\.0:(\d+)->/.test(e))
        .map((e) => ({
        name: e.split("@@")[1],
        port: parseInt(e.match(/^0\.0\.0\.0:(\d+)->/)[1]),
    }));
    return containerInfo;
}
exports.getContainerInfo = getContainerInfo;
function createFunction(app, name, port) {
    app.post(`/${name}`, async (req, res) => {
        const postStream = got_1.default.stream.post(`http://localhost:${port}`);
        await pipeline(req, postStream);
        await pipeline(postStream, res);
    });
}
exports.createFunction = createFunction;
function removeRoute(path, routes) {
    var _a, _b, _c;
    for (let i = 0; i < routes.length; i++) {
        if (((_a = routes[i]) === null || _a === void 0 ? void 0 : _a.path) === path) {
            routes.splice(i, 1);
            break;
        }
        if (((_c = (_b = routes[i]) === null || _b === void 0 ? void 0 : _b.route) === null || _c === void 0 ? void 0 : _c.path) && routes[i].route.path === path) {
            routes.splice(i, 1);
        }
    }
}
exports.removeRoute = removeRoute;
async function getRunningContainerID(name) {
    const { stdout, } = await execa_1.default.command(`docker ps --format "{{.ID}}:{{.Names}}" | grep :${name} || true`, { shell: true });
    const [runningContainerId] = stdout.split(":");
    return runningContainerId;
}
exports.getRunningContainerID = getRunningContainerID;
async function createFunctionFiles(name, packageJson, script) {
    await mkdirPromise(name);
    // Save the package.json in the temporary directory
    await writeFilePromise(`../${name}/package.json`, JSON.stringify(packageJson, null, 2));
    // Save our serverless function in the directory
    await writeFilePromise(`../${name}/function.js`, script);
}
exports.createFunctionFiles = createFunctionFiles;
async function processInput(sub, res, options = { log: true }) {
    sub.stdout.on("data", (data) => {
        res.write(data);
        console.log(options);
        if (options.log) {
            console.log(data.toString());
        }
    });
    sub.on("error", (err) => {
        res.write(err);
        res.end();
        console.log(err);
    });
    await sub;
}
exports.processInput = processInput;
function respondAndLog(res, input) {
    console.log(input);
    res.write(`${input}\n`);
}
exports.respondAndLog = respondAndLog;
