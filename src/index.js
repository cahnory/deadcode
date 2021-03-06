import { parseAsync, DEFAULT_EXTENSIONS } from "@babel/core";
import * as babel from "@babel/core";
import fs from "fs";
import path from "path";
import glob from "glob";
import minimatch from "minimatch";

import traverse from "./traverse";

const promisify = func => (...args) =>
  new Promise((resolve, reject) => {
    func(...args, (error, ...rest) => {
      if (error) {
        reject(error);
      } else {
        resolve(...rest);
      }
    });
  });

const readFileAsync = promisify(fs.readFile);
const globAsync = promisify(glob);
const none = () => {};

const getDeadFiles = async ({
  entry = [],
  include = DEFAULT_EXTENSIONS.map(ext => `${process.cwd()}/**/*${ext}`),
  ignore = ["**/node_modules/**"],
  onTraverseFile = none
}) => {
  if (!Array.isArray(entry)) {
    entry = [entry];
  }

  if (!Array.isArray(include)) {
    include = [include];
  }

  if (!Array.isArray(ignore)) {
    ignore = [ignore];
  }

  const {
    dependencies,
    dynamicDependencies,
    unparsedDependencies,
    unresolvedDependencies,
    ignoredDependencies
  } = await getDependencies({ entry, ignore, onTraverseFile });
  const includedFiles = await getIncludedFiles({ include, ignore });
  const deadFiles = includedFiles.filter(
    file => dependencies.indexOf(file) === -1
  );

  return {
    deadFiles,
    dependencies,
    dynamicDependencies,
    unparsedDependencies,
    unresolvedDependencies,
    ignoredDependencies
  };
};

const getDependencies = async ({ entry, ignore, onTraverseFile }) => {
  const traverseStack = await Promise.all(
    entry.map(filename =>
      require.resolve(path.resolve(process.cwd(), filename))
    )
  );
  const dependencies = [];
  const dynamicDependencies = [];
  const unparsedDependencies = [];
  const unresolvedDependencies = [];
  const ignoredDependencies = [];

  const traverseNext = async () => {
    if (!traverseStack.length) {
      return;
    }

    const filename = traverseStack.shift();

    if (ignore.find(pattern => minimatch(filename, pattern))) {
      ignoredDependencies.push(filename);
      return traverseNext();
    }

    const dirname = path.dirname(filename);
    const src = await readFileAsync(filename, "UTF-8").catch(() => {});
    let res;

    dependencies.push(filename);
    onTraverseFile(filename);

    try {
      const ast = await parseAsync(src, { filename });
      res = traverse(ast);
    } catch {
      unparsedDependencies.push(filename);
      return traverseNext();
    }

    res.dependencies.forEach(dependency => {
      let filename;

      try {
        if (dependency.match(/^[.\/]/)) {
          filename = require.resolve(path.join(dirname, dependency));
        } else {
          filename = require.resolve(dependency);
        }
      } catch (error) {
        if (unresolvedDependencies.indexOf(dependency) === -1) {
          unresolvedDependencies.push(dependency);
        }
        return;
      }

      if (
        traverseStack.indexOf(filename) === -1 &&
        dependencies.indexOf(filename) === -1
      ) {
        traverseStack.push(filename);
      }
    });

    if (res.dynamicDependencies.length) {
      dynamicDependencies.push(filename);
    }

    await traverseNext();
  };

  await traverseNext();

  return {
    dependencies,
    dynamicDependencies,
    unparsedDependencies,
    unresolvedDependencies,
    ignoredDependencies
  };
};

const getIncludedFiles = async ({ include, ignore }) => {
  const files = [];

  await Promise.all(
    include.map(async pattern => {
      (await globAsync(pattern, {
        ignore,
        realpath: true,
        nodir: true
      })).forEach(file => {
        if (files.indexOf(file) === -1) {
          files.push(file);
        }
      });
    })
  );

  return files;
};

export default getDeadFiles;
