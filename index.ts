import { writeFile, mkdir, rmdir } from "fs";
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
} from "./util";

const writeFilePromise = promisify(writeFile);
const mkdirPromise = promisify(mkdir);
const rmDirPromise = promisify(rmdir);

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// a debugging route
app.get("/routes", (req, res) => {
  res.json({
    routes: app._router.stack.filter((r) => !!r.route).map((r) => r.route.path),
  });
});

app.post("/create", async (req, res) => {
  // name should be just [a-z0-9_-]
  const { script, packageJson } = req.body;
  const { name } = JSON.parse(packageJson);

  try {
    // add express to dependencies
    const packageFile = JSON.parse(packageJson);
    packageFile.dependencies = {
      express: "^4.17.1",
      ...packageFile.dependencies,
    };

    // Make a temp directory where we very briefly store the files
    await mkdirPromise(name);

    // Save the package.json in the temporary directory
    await writeFilePromise(
      `./${name}/package.json`,
      JSON.stringify(packageFile, null, 2)
    );

    // Save our serverless function in the directory
    await writeFilePromise(`./${name}/function.js`, script);

    // build the container
    await execa(
      "docker",
      ["build", "-t", name, "--build-arg", `FUNC_NAME=${name}`, "."],
      { stdio: "inherit" }
    );

    // choose a random free port
    // in the future, as soon as a port is selected it should not be available to `get()` again,
    // so that there is no race conditon
    const functionPort = await getPort();

    // find out if there is already a running container
    const runningContainerId = await getRunningContainerID(name);

    // run container
    await execa("docker", [
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `${functionPort}:8000`,
      name,
    ]);

    // wait for the container to become available
    await waitOn({
      resources: [`http-get://localhost:${functionPort}/healthcheck`],
      interval: 1000,
    });

    // create a "proxy" handler for the function
    createFunction(app, name, functionPort);

    // If there was a container already running for this function, remove it
    if (runningContainerId) {
      removeRoute(`/${name}`, app._router.stack);
      await execa("docker", ["rm", "--force", runningContainerId], {
        stdio: "inherit",
      });
    }

    rmDirPromise(name, { recursive: true });

    res.send("OK");
  } catch (e) {
    console.error(e);
    rmDirPromise(name, { recursive: true });
    res.status(500).send("There was an error");
  }
});

app.delete("/delete/:name", async (req, res) => {
  const { name } = req.params;

  const runningContainerId = await getRunningContainerID(name);

  removeRoute(`/${name}`, app._router.stack);

  if (runningContainerId) {
    await execa("docker", ["rm", "--force", runningContainerId], {
      stdio: "inherit",
    });
  }
  res.send("OK");
});

async function init() {
  const containerInfo = await getContainerInfo();

  for (let { name, port } of containerInfo) {
    createFunction(app, name, port);
  }

  app.listen(port, () =>
    console.log(`Example app listening at http://localhost:${port}`)
  );
}

init();
