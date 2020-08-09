"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const util_1 = require("util");
const express_1 = __importDefault(require("express"));
const execa_1 = __importDefault(require("execa"));
const wait_on_1 = __importDefault(require("wait-on"));
const get_port_1 = __importDefault(require("get-port"));
const util_2 = require("./util");
const rmDirPromise = util_1.promisify(fs_1.rmdir);
const app = express_1.default();
const port = 3000;
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
// a debugging route
app.get("/_routes", (req, res) => {
    res.json({
        routes: app._router.stack.filter((r) => !!r.route).map((r) => r.route.path),
    });
});
app.post("/create", async (req, res) => {
    // name should be just [a-z0-9_-]
    const { script, packageJson, packageJson: { name }, } = req.body;
    try {
        // add express to dependencies
        // const packageFile = JSON.parse(packageJson);
        packageJson.dependencies = {
            express: "4.17.1",
            ...packageJson.dependencies,
        };
        // Make a temp directory where we very briefly store the files
        // Copy the package.json there and the
        await util_2.createFunctionFiles(name, packageJson, script);
        util_2.respondAndLog(res, "Building the container...");
        let subprocess;
        // build the container
        subprocess = execa_1.default("docker", [
            "build",
            "-t",
            name,
            "--build-arg",
            `FUNC_NAME=${name}`,
            ".",
        ]);
        await util_2.processInput(subprocess, res);
        // choose a random free port
        // in the future, as soon as a port is selected it should not be available to `get()` again,
        // so that there is no race conditon
        const functionPort = await get_port_1.default();
        util_2.respondAndLog(res, `Assigning port ${functionPort} to '${name}'`);
        // find out if there is already a running container
        const runningContainerId = await util_2.getRunningContainerID(name);
        if (runningContainerId) {
            util_2.respondAndLog(res, "Renaming the old container...");
            subprocess = execa_1.default("docker", ["rename", name, `${name}-to-be-deleted`]);
            await util_2.processInput(subprocess, res);
        }
        // run container
        subprocess = execa_1.default("docker", [
            "run",
            "-d",
            "--name",
            name,
            "-p",
            `${functionPort}:8000`,
            name,
        ]);
        util_2.respondAndLog(res, "Running the new container...");
        await util_2.processInput(subprocess, res);
        util_2.respondAndLog(res, "Waiting for the new container to become available...");
        // wait for the container to become available
        await wait_on_1.default({
            resources: [`http-get://localhost:${functionPort}/healthcheck`],
        });
        // create a "proxy" handler for the function
        util_2.createFunction(app, name, functionPort);
        util_2.respondAndLog(res, `Created a function for ${name}.`);
        // If there was a container already running for this function, remove it
        if (runningContainerId) {
            util_2.removeRoute(`/${name}`, app._router.stack);
            subprocess = execa_1.default("docker", ["rm", "--force", runningContainerId]);
            await util_2.processInput(subprocess, res);
            util_2.respondAndLog(res, `Removing old container ${name} with ID: ${runningContainerId}...`);
        }
        util_2.respondAndLog(res, "Cleaning up...");
        rmDirPromise(name, { recursive: true });
        res.end();
    }
    catch (e) {
        console.error(e);
        rmDirPromise(name, { recursive: true });
        res.status(500).end("There was an error");
    }
});
app.delete("/delete/:name", async (req, res) => {
    try {
        const { name } = req.params;
        const runningContainerId = await util_2.getRunningContainerID(name);
        util_2.removeRoute(`/${name}`, app._router.stack);
        if (runningContainerId) {
            await execa_1.default("docker", ["rm", "--force", runningContainerId], {
                stdio: "inherit",
            });
        }
        res.send("OK");
    }
    catch (err) {
        console.error(err);
        res.status(500).send("There was an error");
    }
});
async function init() {
    const containerInfo = await util_2.getContainerInfo();
    for (const { name, port } of containerInfo) {
        util_2.createFunction(app, name, port);
    }
    app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));
}
init();
