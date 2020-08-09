#!/usr/bin/env node

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import got from "got";
import program from "commander";

const parseFileToObject = async (filename) => {
  try {
    const fileContents = await readFile(filename, "utf-8");
    const content = JSON.parse(fileContents);
    return content;
  } catch (err) {
    throw new Error(`The ${filename} is not valid JSON`);
  }
};

function validateFileExists(filename) {
  if (!existsSync(filename)) {
    throw new Error(`There is no ${filename} package.json file`);
  }
}

const create = async () => {
  validateFileExists("./package.json");
  validateFileExists("./index.js");
  validateFileExists("./funcker.config.json");

  try {
    const packageJson = await parseFileToObject("./package.json");
    const { name } = packageJson;
    if (!name) {
      throw new Error(
        "The package.json needs to contain a valid name parameter"
      );
    }

    const { url } = await parseFileToObject("./funcker.config.json");
    if (!url) {
      throw new Error(
        "The funcker.config.json needs to contain a valid url parameter"
      );
    }

    const script = await readFile("./index.js", "utf-8");

    const response = got.post(`${url}/create`, {
      json: { packageJson, script },
      isStream: true,
    });

    response.pipe(process.stdout);

    response.on("end", () => {
      process.exit(0);
    });

    response.on("error", (err) => {
      console.error(err);
    });
  } catch (err) {
    console.error(err);
  }
};

program
  .command("create")
  .description("Creates a Funcker serverless function")
  .action(create);

program.on("command:*", ([command]) => {
  console.log("Unknown command: ", command);
  program.help();
});

// Parses the arguments and adds them to the `command` object.
program.parse(process.argv);

if (!program.args.length) program.help();
