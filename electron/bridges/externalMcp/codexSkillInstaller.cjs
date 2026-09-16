"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const NETCATTY_CODEX_SKILL_NAME = "netcatty-mcp";
const NETCATTY_SKILL_MANAGED_MARKER = "managed-by: netcatty";

function getBundledNetcattySkillPath() {
  return path.resolve(
    __dirname,
    "../../../skills",
    NETCATTY_CODEX_SKILL_NAME,
    "SKILL.md",
  ).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

function getUserNetcattySkillPath(homeDir = os.homedir()) {
  return path.join(
    homeDir,
    ".agents",
    "skills",
    NETCATTY_CODEX_SKILL_NAME,
    "SKILL.md",
  );
}

async function lstatIfPresent(filePath, fsApi) {
  try {
    return await fsApi.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readBundledSkill(sourcePath, fsApi) {
  const content = await fsApi.readFile(sourcePath, "utf8");
  if (!content.includes(NETCATTY_SKILL_MANAGED_MARKER)) {
    throw new Error("Bundled Netcatty skill is missing its ownership marker.");
  }
  return content;
}

async function getNetcattyCodexSkillStatus(options = {}) {
  const fsApi = options.fs || fs;
  const sourcePath = options.sourcePath || getBundledNetcattySkillPath();
  const skillPath = options.skillPath || getUserNetcattySkillPath(options.homeDir);
  const expectedContent = await readBundledSkill(sourcePath, fsApi);
  const skillDir = path.dirname(skillPath);
  const dirStat = await lstatIfPresent(skillDir, fsApi);

  if (dirStat?.isSymbolicLink() || (dirStat && !dirStat.isDirectory())) {
    return {
      installed: false,
      managed: false,
      conflict: true,
      skillPath,
      reason: "The Netcatty skill directory is not a regular directory.",
    };
  }

  const fileStat = await lstatIfPresent(skillPath, fsApi);
  if (!fileStat) {
    return { installed: false, managed: false, conflict: false, skillPath };
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    return {
      installed: false,
      managed: false,
      conflict: true,
      skillPath,
      reason: "The Netcatty SKILL.md path is not a regular file.",
    };
  }

  const currentContent = await fsApi.readFile(skillPath, "utf8");
  const managed = currentContent.includes(NETCATTY_SKILL_MANAGED_MARKER);
  return {
    installed: currentContent === expectedContent,
    managed,
    conflict: !managed,
    skillPath,
    ...(!managed ? { reason: "An unmanaged skill already exists at this path." } : {}),
  };
}

async function installNetcattyCodexSkill(options = {}) {
  const fsApi = options.fs || fs;
  const sourcePath = options.sourcePath || getBundledNetcattySkillPath();
  const skillPath = options.skillPath || getUserNetcattySkillPath(options.homeDir);
  const status = await getNetcattyCodexSkillStatus({ fs: fsApi, sourcePath, skillPath });

  if (status.installed) {
    return { ...status, changed: false };
  }
  if (status.conflict) {
    throw new Error(`${status.reason} Refusing to overwrite ${skillPath}.`);
  }

  const content = await readBundledSkill(sourcePath, fsApi);
  await fsApi.mkdir(path.dirname(skillPath), { recursive: true, mode: 0o700 });
  await fsApi.writeFile(skillPath, content, { encoding: "utf8", mode: 0o600 });
  await fsApi.chmod(skillPath, 0o600);

  return {
    installed: true,
    managed: true,
    conflict: false,
    changed: true,
    skillPath,
  };
}

module.exports = {
  NETCATTY_CODEX_SKILL_NAME,
  NETCATTY_SKILL_MANAGED_MARKER,
  getBundledNetcattySkillPath,
  getUserNetcattySkillPath,
  getNetcattyCodexSkillStatus,
  installNetcattyCodexSkill,
};
