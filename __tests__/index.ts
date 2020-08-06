import { getContainerInfo, getRunningContainerID } from "../util";

test("getting the container info", async () => {
  expect(await getContainerInfo()).toMatchInlineSnapshot(`Array []`);
});

test("check getting the running container ID", async () => {
  const containerID = await getRunningContainerID("hello");

  expect(containerID).toMatchInlineSnapshot(`""`);
});
