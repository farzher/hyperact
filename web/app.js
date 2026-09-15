const input = document.querySelector("#input");
const actions = document.querySelector("#actions");
const kind = document.querySelector("#kind");

let items = [];
let selected = 0;

function windowsPath(value) {
  return /^[a-z]:[\\/]/i.test(value.trim());
}

function toWslPath(value) {
  const path = value.trim();
  const drive = path[0].toLowerCase();
  return `/mnt/${drive}${path.slice(2).replaceAll("\\", "/")}`;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildActions(value) {
  if (!value.trim()) return [];

  const result = [];

  if (windowsPath(value)) {
    const path = toWslPath(value);
    result.push(
      {
        icon: ">_",
        title: "Linux cd",
        detail: `cd ${path}`,
        run: () => setInput(`cd ${path}`)
      },
      {
        icon: "/",
        title: "WSL path",
        detail: path,
        run: () => setInput(path)
      }
    );
  }

  result.push(
    {
      icon: "Aa",
      title: "UPPERCASE",
      detail: value.toUpperCase(),
      run: () => setInput(value.toUpperCase())
    },
    {
      icon: "aa",
      title: "lowercase",
      detail: value.toLowerCase(),
      run: () => setInput(value.toLowerCase())
    },
    {
      icon: "#",
      title: "Slugify",
      detail: slugify(value),
      run: () => setInput(slugify(value))
    }
  );

  return result;
}

function detectKind(value) {
  if (!value.trim()) return "";
  if (windowsPath(value)) return "Windows path";
  if (/^https?:\/\//i.test(value.trim())) return "URL";
  return "Text";
}

function setInput(value) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  render();
}

function run(index = selected) {
  items[index]?.run();
}

function render() {
  items = buildActions(input.value);
  selected = Math.min(selected, Math.max(0, items.length - 1));

  const type = detectKind(input.value);
  kind.textContent = type;
  kind.classList.toggle("visible", Boolean(type));

  actions.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Actions appear here";
    actions.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("button");
    row.className = `action${index === selected ? " selected" : ""}`;
    row.type = "button";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === selected ? "true" : "false");

    const icon = document.createElement("span");
    icon.className = "action-icon";
    icon.textContent = item.icon;

    const copy = document.createElement("span");
    copy.className = "action-copy";

    const title = document.createElement("div");
    title.className = "action-title";
    title.textContent = item.title;

    const detail = document.createElement("div");
    detail.className = "action-detail";
    detail.textContent = item.detail;

    const key = document.createElement("span");
    key.className = "action-key";
    key.innerHTML = "<kbd>↵</kbd>";

    copy.append(title, detail);
    row.append(icon, copy, key);

    row.addEventListener("mouseenter", () => {
      selected = index;
      render();
    });
    row.addEventListener("click", () => run(index));
    actions.append(row);
  });

  actions.children[selected]?.scrollIntoView({ block: "nearest" });
}

input.addEventListener("input", () => {
  selected = 0;
  render();
});

window.addEventListener("focus", () => input.focus());

document.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" && items.length) {
    event.preventDefault();
    selected = (selected + 1) % items.length;
    render();
  } else if (event.key === "ArrowUp" && items.length) {
    event.preventDefault();
    selected = (selected - 1 + items.length) % items.length;
    render();
  } else if (event.key === "Enter" && items.length) {
    event.preventDefault();
    run();
  } else if (event.key === "Escape") {
    setInput("");
  }
});

input.focus();
render();
