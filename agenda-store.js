const fs = require("node:fs");
const path = require("node:path");
const Planner = require("./planner-core");

function createStore(file) {
  function read() {
    if (!fs.existsSync(file)) return Planner.normalize({});
    try { return Planner.normalize(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch { throw new Error("Arquivo da agenda ilegivel. Os dados foram preservados; restaure uma copia de .agenda-backups."); }
  }
  function write(input) {
    const previous = read();
    const data = Planner.validate(Planner.normalize(input));
    data.revision = previous.revision + 1;
    data.updatedAt = new Date().toISOString();
    // Tarefas da rodada nao entram no planejamento: decidir uma delas nao replaneja o dia.
    const constraints = value => JSON.stringify([value.entries.filter(entry => !Planner.isSyncTask(entry)), value.goals, value.preferences]);
    if (constraints(previous) !== constraints(data)) data.planningAt = data.updatedAt;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const directory = path.join(path.dirname(file), ".agenda-backups");
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(file, path.join(directory, `${path.basename(file)}.${previous.revision}.json`));
      const own = fs.readdirSync(directory).filter(name => name.startsWith(`${path.basename(file)}.`) && /^\d+\.json$/.test(name.slice(path.basename(file).length + 1)))
        .sort((a, b) => Number(b.split(".").at(-2)) - Number(a.split(".").at(-2)));
      own.slice(30).forEach(name => fs.unlinkSync(path.join(directory, name)));
    }
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return data;
  }
  function merge(base, incoming) {
    const result = Planner.merge(read(), base, incoming);
    if (result.conflicts.length) return result;
    return { data: write(result.data), conflicts: [] };
  }
  return { read, write, merge };
}
module.exports = { createStore };
