import { rmdir } from "fs";
import { promisify } from "util";

import express from "express";
import execa from "execa";
import waitOn from "wait-on";
import getPort from "get-port";

import {
  getContainerInfo,
  createFunction,
  removeRoute,
  getRunningContainerID,
  createFunctionFiles,
  processInput,
  respondAndLog,
} from "./util";

const rmDirPromise = promisify(rmdir);

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// a debugging route
app.get("/_routes", (req, res) => {
  res.json({
    routes: app._router.stack.filter((r) => !!r.route).map((r) => r.route.path),
  });
});

app.post("/create", async (req, res) => {
  // name should be just [a-z0-9_-]
  const {
    script,
    packageJson,
    packageJson: { name },
  } = req.body;

  try {
    // add express to dependencies
    // const packageFile = JSON.parse(packageJson);
    packageJson.dependencies = {
      express: "4.17.1",
      ...packageJson.dependencies,
    };

    // Make a temp directory where we very briefly store the files
    // Copy the package.json there and the
    await createFunctionFiles(name, packageJson, script);

    respondAndLog(res, "Building the container...");

    let subprocess: execa.ExecaChildProcess;

    // build the container
    subprocess = execa("docker", [
      "build",
      "-t",
      name,
      "--build-arg",
      `FUNC_NAME=${name}`,
      ".",
    ]);

    await processInput(subprocess, res);

    // choose a random free port
    // in the future, as soon as a port is selected it should not be available to `get()` again,
    // so that there is no race conditon
    const functionPort = await getPort();

    respondAndLog(res, `Assigning port ${functionPort} to '${name}'`);

    // find out if there is already a running container
    const runningContainerId = await getRunningContainerID(name);

    if (runningContainerId) {
      respondAndLog(res, "Renaming the old container...");
      subprocess = execa("docker", ["rename", name, `${name}-to-be-deleted`]);
      await processInput(subprocess, res);
    }

    // run container
    subprocess = execa("docker", [
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `${functionPort}:8000`,
      name,
    ]);

    respondAndLog(res, "Running the new container...");
    await processInput(subprocess, res);

    respondAndLog(res, "Waiting for the new container to become available...");
    // wait for the container to become available
    await waitOn({
      resources: [`http-get://localhost:${functionPort}/healthcheck`],
    });

    // create a "proxy" handler for the function
    createFunction(app, name, functionPort);
    respondAndLog(res, `Created a function for ${name}.`);

    // If there was a container already running for this function, remove it
    if (runningContainerId) {
      removeRoute(`/${name}`, app._router.stack);
      subprocess = execa("docker", ["rm", "--force", runningContainerId]);
      await processInput(subprocess, res);
      respondAndLog(
        res,
        `Removing old container ${name} with ID: ${runningContainerId}...`
      );
    }

    respondAndLog(res, "Cleaning up...");
    rmDirPromise(name, { recursive: true });

    res.end();
  } catch (e) {
    console.error(e);
    rmDirPromise(name, { recursive: true });
    res.status(500).end("There was an error");
  }
});

app.delete("/delete/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const runningContainerId = await getRunningContainerID(name);
    removeRoute(`/${name}`, app._router.stack);

    if (runningContainerId) {
      await execa("docker", ["rm", "--force", runningContainerId], {
        stdio: "inherit",
      });
    }
    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("There was an error");
  }
});

async function init() {
  const containerInfo = await getContainerInfo();

  for (const { name, port } of containerInfo) {
    createFunction(app, name, port);
  }

  app.listen(port, () =>
    console.log(`Example app listening at http://localhost:${port}`)
  );
}

init();
