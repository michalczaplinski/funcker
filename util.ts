import stream from "stream";
import { promisify } from "util";

import express from "express";
import got from "got";
import execa from "execa";

const pipeline = promisify(stream.pipeline);

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
  console.log(`Created a function for ${name}`);
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
