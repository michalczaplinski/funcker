import { writeFile, mkdir, rmdir } from "fs";
import { promisify } from "util";
import stream from "stream";

import express from "express";
import execa from "execa";
import waitOn from "wait-on";
import got from "got";
import getPort from "get-port";

const writeFilePromise = promisify(writeFile);
const mkdirPromise = promisify(mkdir);
const rmDirPromise = promisify(rmdir);
const pipeline = promisify(stream.pipeline);

const app = express();
const port = 3000;

// This is a map of port --> name of function
// In a "real" application this would be a key-value store like redis
const cache = {};

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.post("/create", async (req, res) => {
  // name should be just [a-z0-9_-]
  const { name, script, packageJson } = req.body;

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
    const functionPort = await getPort();
    cache["name"] = functionPort;

    // run container
    execa("docker", [
      "run",
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

    // Add the path to express
    // We ll have to delete them later when the user deletes the function
    app.post(`/${name}`, async (req, res) => {
      const postStream = got.stream.post(`http://localhost:${functionPort}`);

      await pipeline(req, postStream);
      await pipeline(postStream, res);
    });

    rmDirPromise(name, { recursive: true });

    res.send("OK");
  } catch (e) {
    console.error(e);
    rmDirPromise(name, { recursive: true });
    res.status(500).send("There was an error");
  }
});

app.listen(port, () =>
  console.log(`Example app listening at http://localhost:${port}`)
);

/*

We need 
- validate params
- add/remove requests from the cache
- add auth so that a user can only create a few containers

- what to do when the contaienr already exists?
*/
