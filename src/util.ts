import stream from "stream";
import { writeFile, mkdir } from "fs";
import { promisify } from "util";
import { join } from "path";

import express, { Response } from "express";
import got from "got";
import execa from "execa";

const pipeline = promisify(stream.pipeline);
const writeFilePromise = promisify(writeFile);
const mkdirPromise = promisify(mkdir);

export async function getContainerInfo() {
  const { stdout } = await execa.command(
    'docker ps --format "{{.Ports}}@@{{.Names}}" --filter "status=running"',
    {
      shell: true,
    }
  );

  const containerInfo = stdout
    .split("\n")
    .filter((e) => /^0\.0\.0\.0:(\d+)->/.test(e))
    .map((e) => ({
      name: e.split("@@")[1],
      port: parseInt(e.match(/^0\.0\.0\.0:(\d+)->/)[1]),
    }));

  return containerInfo;
}

export function createFunction(
  app: express.Application,
  name: string,
  port: number
) {
  app.post(`/${name}`, async (req, res) => {
    const postStream = got.stream.post(`http://localhost:${port}`);
    await pipeline(req, postStream);
    await pipeline(postStream, res);
  });
}

export function removeRoute(
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

export async function getRunningContainerID(name: string) {
  const {
    stdout,
  } = await execa.command(
    `docker ps --format "{{.ID}}:{{.Names}}" | grep :${name} || true`,
    { shell: true }
  );
  const [runningContainerId] = stdout.split(":");

  return runningContainerId;
}

export async function createFunctionFiles(
  name: any,
  packageJson: any,
  script: any
) {
  await mkdirPromise(join(__dirname, `../${name}`));

  // Save the package.json in the temporary directory
  await writeFilePromise(
    join(__dirname, `../${name}/package.json`),
    JSON.stringify(packageJson, null, 2)
  );

  // Save our serverless function in the directory
  await writeFilePromise(join(__dirname, `../${name}/function.js`), script);
}

export async function processInput(
  sub: execa.ExecaChildProcess<string>,
  res: express.Response,
  options: { log: boolean } = { log: true }
) {
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

export function respondAndLog(res: Response, input: string) {
  console.log(input);
  res.write(`${input}\n`);
}
