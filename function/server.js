const express = require("express");
const handler = require("./function.js");

const app = express();
const port = 8000;

app.post("/", handler);

app.get("/healthcheck", (req, res) => res.send("OK"));

app.listen(port, () =>
  console.log(`Example app listening at http://localhost:${port}`)
);
