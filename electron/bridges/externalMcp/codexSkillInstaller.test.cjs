"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  NETCATTY_SKILL_MANAGED_MARKER,
  getBundledNetcattySkillPath,
  getUserNetcattySkillPath,
  getNetcattyCodexSkillStatus,
  installNetcattyCodexSkill,
} = require("./codexSkillInstaller.cjs");

async function withTempHome(run) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "netcatty-codex-skill-"));
  try {
    await run(homeDir);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

test("installs the bundled Netcatty skill in the Codex user skill directory", async () => {
  await withTempHome(async (homeDir) => {
    const result = await installNetcattyCodexSkill({ homeDir });
    const expected = await fs.readFile(getBundledNetcattySkillPath(), "utf8");
    const installed = await fs.readFile(getUserNetcattySkillPath(homeDir), "utf8");

    assert.equal(result.installed, true);
    assert.equal(result.changed, true);
    assert.equal(installed, expected);
    assert.equal((await getNetcattyCodexSkillStatus({ homeDir })).installed, true);

    const repeated = await installNetcattyCodexSkill({ homeDir });
    assert.equal(repeated.changed, false);
  });
});

test("updates an older Netcatty-managed skill", async () => {
  await withTempHome(async (homeDir) => {
    const skillPath = getUserNetcattySkillPath(homeDir);
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, `---\nmetadata:\n  ${NETCATTY_SKILL_MANAGED_MARKER}\n---\nold\n`);

    const result = await installNetcattyCodexSkill({ homeDir });
    assert.equal(result.changed, true);
    assert.match(await fs.readFile(skillPath, "utf8"), /name: netcatty-mcp/);
  });
});

test("refuses to overwrite an unmanaged skill with the same name", async () => {
  await withTempHome(async (homeDir) => {
    const skillPath = getUserNetcattySkillPath(homeDir);
    const customContent = "---\nname: netcatty-mcp\ndescription: custom\n---\ncustom\n";
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, customContent);

    await assert.rejects(
      installNetcattyCodexSkill({ homeDir }),
      /unmanaged skill already exists/i,
    );
    assert.equal(await fs.readFile(skillPath, "utf8"), customContent);
  });
});
