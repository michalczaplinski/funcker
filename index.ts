import { writeFile, mkdir, rmdir } from "fs";
import { promisify } from "util";
import stream from "stream";

import express from "express";
import execa from "execa";
import waitOn from "wait-on";
import got from "got";
import getPort from "get-port";
import Redis from "ioredis";

const writeFilePromise = promisify(writeFile);
const mkdirPromise = promisify(mkdir);
const rmDirPromise = promisify(rmdir);
const pipeline = promisify(stream.pipeline);

const app = express();
const port = 3000;

const redis = new Redis();

function removeRoute(
  path: string,
  routes: (express.IRoute & { route: { path: string } })[]
) {
  for (let i = 0; i < routes.length; i++) {
    if (routes[i]?.path === path) {
      routes.splice(i, 1);
      break;
    }
    if (routes[i]?.route?.path && routes[i].route.path === path) {
      routes.splice(i, 1);
    }
  }
}

async function init() {
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // a debugging route
  app.get("/routes", (req, res) => {
    res.json({
      routes: app._router.stack
        .filter((r) => !!r.route)
        .map((r) => r.route.path),
    });
  });

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

      // run container
      const { stdout: containerId } = await execa("docker", [
        "run",
        "-d",
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
      app.post(`/${name}`, async (req, res) => {
        const postStream = got.stream.post(`http://localhost:${functionPort}`);

        await pipeline(req, postStream);
        await pipeline(postStream, res);
      });

      // check if the info of rthis route already exists in redis
      const val = await redis.get(name);
      if (val) {
        removeRoute(`/${name}`, app._router.stack);
        const { containerId } = JSON.parse(val);
        await execa("docker", ["rm", "--force", containerId], {
          stdio: "inherit",
        });
      }

      // set the info in redis for this route
      await redis.set(
        name,
        JSON.stringify({ port: functionPort, containerId })
      );

      rmDirPromise(name, { recursive: true });

      res.send("OK");
    } catch (e) {
      console.error(e);
      rmDirPromise(name, { recursive: true });
      res.status(500).send("There was an error");
    }
  });

  // This is a terrible way to do it, but 🤷‍♂️
  // On startup we get the (function name --> container port) mapping from redis
  const functionNames = await redis.keys("*");
  for (let name of functionNames) {
    const { port } = JSON.parse(await redis.get(name));

    // Should at this point probably check if the container is actually still alive!
    app.post(`/${name}`, async (req, res) => {
      const postStream = got.stream.post(`http://localhost:${port}`);
      await pipeline(req, postStream);
      await pipeline(postStream, res);
    });
  }

  app.listen(port, () =>
    console.log(`Example app listening at http://localhost:${port}`)
  );
}

init();

/*

Nice to have:

- validate params
- stream response

To do:
- Actually get rid of redis
- Check `docker ps` to get container IDs, ports and route names
- Allow deleting functions

*/
