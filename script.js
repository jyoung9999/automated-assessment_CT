/* =========================================================
 * Hello Maple CT 자동채점 도구 (v3: .mod 블록 객체 비교)
 * - 교사 템플릿 .mod와 학생 .mod를 비교해 "학생이 새로 추가한 블록"만 채점
 * - 블록 고유 ID 기준: 템플릿 블록은 옮기거나 끼워 넣어도 제외됨
 * - 루브릭: Von Wangenheim et al. (2018), 0~3점, 충족한 최고 수준
 * ========================================================= */

/* ---------- 1. 루브릭 대응표 (필요하면 여기만 수정) ---------- */
const RUBRIC = {
  // 사용자 정의 블록(함수)로 볼 컴포넌트 이름
  customBlockComps: ["BlockFunctionEntity", "BlockFunctionImplement", "FunctionLogic"],
  cloneTypes: ["Clone", "OnClone", "DestroyClone", "DestroyCloneAll"],

  greenFlag: ["OnBeginPlay"],
  keyEvents: ["OnKeyDown", "OnKeyHold", "OnKeyUp"],
  clickEvents: ["OnMouseClick", "OnMouseRelease", "OnTouchDownEntity", "OnTouchReleaseEntity"],
  askTypes: ["InputPopup"],
  soundTypes: ["PlaySound", "PlaySoundState", "PlaySoundWhileSeconds", "PlaySoundAndWait",
    "PlaySoundTimePositionAndWait", "StartBGM"],

  messageEvents: ["OnGlobalEvent"],
  sensingConds: ["conditionTrigger", "conditionKeyDown", "conditionMouse"],

  actorProps: ["TranslateX", "TranslateY", "SetPositionX", "SetPositionY", "SetPositionXY",
    "MoveTo", "Move", "MoveDirection", "Tween", "TweenToPosition", "TweenToTarget", "Rotate",
    "TweenRotate", "SetRotation", "TweenToRotation", "LookRotation", "AddScale", "AddScaleXY",
    "SetScale", "ResetScale", "FlipX", "FlipY", "VisibleOn", "VisibleOff", "ColorChange",
    "PlayAnimation", "Teleport"],
  variableOps: ["SetValue", "SumValue", "ShowValue", "SetData", "SetDataRandom", "getValue",
    "SetTextValue", "AppendToText", "InsertAt0ToText", "ClearTextValue", "getTextValue"],
  listOps: ["listAddValue", "listDeleteValue", "listInsertValue", "listSetValue", "listShow",
    "listGetValue", "listGetValueCount", "conditionListHasValue"],

  ifThen: ["ifCheck"],
  ifElse: ["ifElseCheck", "loopElseCondition"],
  logicalOps: ["conditionAndOr", "conditionNot"],

  loops: ["loopCount", "infiniteLoop"],
  repeatUntil: ["loopCondition", "loopElseCondition"],

  wait: ["Wait"],
  sayWithTime: ["ChatBalloonWait"],
  // 'wait until': 교사 채점 기준에 따라 '묻고 대답 기다리기'(대답이 올 때까지 대기)와 '신호 보내고 기다리기'
  waitUntil: ["InputPopup", "GlobalEventWait"],

  // 'custom blocks': 교사 채점 기준에 따라 학생이 추가한 신호 보내기/받기를 사용자 정의로 인정
  customSignals: ["GlobalEvent", "GlobalEventWait", "OnGlobalEvent"],

  // 연산자 종류(같은 그룹은 한 종류로 셈). 그리고·또는은 서로 다른 종류로 셈
  operatorGroups: {
    "산술": ["sum", "mod", "power"],
    "난수": ["random"],
    "비교": ["conditionValues", "conditionDataToData"],
    "그리고": ["conditionAndOr:그리고"],
    "또는": ["conditionAndOr:또는"],
    "부정": ["conditionNot"],
    "문자열": ["stringLength", "stringSum", "getChar", "subString", "getStringIndex",
      "replaceString", "upperString"],
  },
  // '~만큼 더하기'(SumValue)를 산술 연산자로도 셀지 (교사 기준 확인 후 true로 바꿀 수 있음)
  sumValueAsArithmetic: false,
};

const LABELS = {
  OnBeginPlay: "시작할 때", OnKeyDown: "키를 눌렀을 때", OnKeyHold: "키를 누르고 있을 때",
  OnKeyUp: "키를 뗄 때", OnMouseClick: "마우스를 클릭했을 때", OnTouchDownEntity: "오브젝트를 클릭했을 때",
  OnGlobalEvent: "신호를 받았을 때", OnClone: "복제본이 생성되었을 때", OnMapEnter: "맵이 전환되었을 때",
  ifCheck: "만일 ~이라면", ifElseCheck: "만일 ~이라면 / 아니면", infiniteLoop: "무한 반복하기",
  loopCount: "~번 반복하기", loopCondition: "~할 때까지 반복하기", conditionAndOr: "그리고/또는",
  conditionNot: "~가 아니다", conditionValues: "값 비교", conditionTrigger: "~에 닿았는가?",
  ChatBalloon: "말하기", ChatBalloonWait: "~초 동안 말하기", Wait: "~초 기다리기",
  InputPopup: "묻고 대답 기다리기", SetValue: "변수 ~로 정하기", SumValue: "변수 ~만큼 더하기",
  ShowValue: "변수 보이기", getValue: "변수 값", GlobalEvent: "신호 보내기",
  GlobalEventWait: "신호 보내고 기다리기", VisibleOn: "보이기", Break: "반복 멈추기", VisibleOff: "숨기기",
  SetControl: "아바타로 만들기", Clone: "복제하기", answer: "대답", input: "입력값", number: "숫자",
};

/* ---------- 2. protobuf 최소 파서 ---------- */
function readVarint(b, i) {
  let r = 0, mul = 1, x;
  do { x = b[i++]; r += (x & 0x7f) * mul; mul *= 128; } while (x >= 0x80);
  return [r, i];
}
function parseMsg(b) {
  const out = []; let i = 0;
  while (i < b.length) {
    let k; [k, i] = readVarint(b, i);
    const f = Math.floor(k / 8), t = k & 7; let v;
    if (t === 0) { [v, i] = readVarint(b, i); }
    else if (t === 2) { let l; [l, i] = readVarint(b, i); v = b.subarray(i, i + l); i += l; }
    else if (t === 1) { v = b.subarray(i, i + 8); i += 8; }
    else if (t === 5) { v = b.subarray(i, i + 4); i += 4; }
    else throw new Error("알 수 없는 protobuf 형식 (wire type " + t + ")");
    out.push({ f, t, v });
  }
  return out;
}
const UTF8 = new TextDecoder("utf-8");
const str = (u8) => UTF8.decode(u8);

/* ---------- 3. .mod → 블록 목록 ---------- */
function parseValues(s) {
  const o = {};
  (s || "").split("\n").forEach((line) => {
    const p = line.split("\t");
    if (p.length >= 4) o[p[1]] = p.slice(3).join("\t");
  });
  return o;
}

function extractBlocks(u8) {
  const blocks = new Map(); // id -> block
  for (const top of parseMsg(u8)) {
    if (top.f !== 2 || top.t !== 2) continue;
    const entry = parseMsg(top.v);
    const typeF = entry.find((x) => x.f === 4);
    const bodyF = entry.find((x) => x.f === 6);
    if (!typeF || !bodyF) continue;
    const ctype = str(typeF.v);
    if (ctype !== "x-mod/map" && ctype !== "x-mod/ui") continue;
    for (const ent of parseMsg(bodyF.v)) {
      if (ent.f !== 3 || ent.t !== 2) continue;
      const fields = {};
      for (const x of parseMsg(ent.v)) fields[x.f] = x.v;
      if (!fields[1] || !fields[3]) continue;
      let j; try { j = JSON.parse(str(fields[3])); } catch (e) { continue; }
      const comps = (j["@components"] || []).filter(
        (c) => c["@type"] && c["@type"].startsWith("script.") && c["@type"] !== "script.MapEntity");
      if (!comps.length) continue;
      const c = comps[0];
      blocks.set(str(fields[1]), {
        id: str(fields[1]),
        path: fields[2] ? str(fields[2]) : j.path || "",
        comp: c["@type"].slice(7),
        type: c.type || "",
        values: parseValues(c.values),
      });
    }
  }
  return blocks;
}

/* ---------- 4. 새 블록 선별 ---------- */
function newBlocks(teacher, student) {
  if (!teacher) return [...student.values()];          // 템플릿 없음 → 전체 채점
  return [...student.values()].filter((b) => !teacher.has(b.id));
}

/* ---------- 5. 루브릭 채점 ---------- */
function scoreBlocks(nb, allStudent) {
  const has = (list) => nb.filter((b) => list.includes(b.type));
  const hasComp = (list) => nb.filter((b) => list.includes(b.comp));
  const scripts = nb.filter((b) => b.comp === "EventTrigger");
  const ofType = (list) => scripts.filter((s) => list.includes(s.type));
  const fmt = (arr) => [...new Set(arr.map((b) => LABELS[b.type] || b.type || b.comp))].join(", ");
  const R = RUBRIC, S = {}, E = {};
  const set = (k, lv, ev) => { if (lv > (S[k] || 0)) { S[k] = lv; E[k] = ev; } };
  Object.keys({ Abstraction: 0, Logic: 0, Parallelism: 0, UserInteractivity: 0,
    DataRepresentation: 0, FlowControl: 0, Synchronization: 0, Operators: 0 })
    .forEach((k) => { S[k] = 0; E[k] = ""; });

  // 스크립트 안의 블록 (경로 접두사 기준)
  const inside = (s) => [...allStudent.values()].filter((b) => b.path.startsWith(s.path + "/"));

  // Abstraction
  if (scripts.length >= 2) set("Abstraction", 1, `새 스크립트 ${scripts.length}개`);
  if (hasComp(R.customBlockComps).length) set("Abstraction", 2, "사용자 정의 블록");
  const sig = nb.filter((b) => R.customSignals.includes(b.type));
  if (sig.length) set("Abstraction", 2, "학생이 만든 신호: " +
    [...new Set(sig.map((b) => b.values.eventName).filter(Boolean))].join(", "));
  if (has(R.cloneTypes).length) set("Abstraction", 3, fmt(has(R.cloneTypes)));

  // Logic
  if (has(R.ifThen).length) set("Logic", 1, fmt(has(R.ifThen)));
  if (has(R.ifElse).length) set("Logic", 2, fmt(has(R.ifElse)));
  if (has(R.logicalOps).length) set("Logic", 3, fmt(has(R.logicalOps)));

  // Parallelism
  if (ofType(R.greenFlag).length >= 2) set("Parallelism", 1, `시작할 때 스크립트 ${ofType(R.greenFlag).length}개`);
  const keyCount = {};
  ofType(["OnKeyDown"]).forEach((s) => { const k = s.values.keyCode || "?"; keyCount[k] = (keyCount[k] || 0) + 1; });
  const sameKey = Object.entries(keyCount).find(([, n]) => n >= 2);
  if (sameKey) set("Parallelism", 2, `같은 키(${sameKey[0]}) 스크립트 ${sameKey[1]}개`);
  if (ofType(R.clickEvents).length >= 2) set("Parallelism", 2, `클릭 스크립트 ${ofType(R.clickEvents).length}개`);
  const sensingScripts = scripts.filter((s) => inside(s).some((b) => R.sensingConds.includes(b.type)));
  if (ofType(R.messageEvents).length >= 2) set("Parallelism", 3, `신호 받기 스크립트 ${ofType(R.messageEvents).length}개`);
  else if (has(["Clone", "OnClone"]).length) set("Parallelism", 3, "복제본 생성");
  else if (sensingScripts.length >= 2) set("Parallelism", 3, `감지 스크립트 ${sensingScripts.length}개`);

  // User Interactivity
  if (ofType(R.greenFlag).length) set("UserInteractivity", 1, "시작할 때");
  const ui2 = [...ofType(R.keyEvents), ...ofType(R.clickEvents), ...has(R.askTypes)];
  if (ui2.length) set("UserInteractivity", 2, fmt(ui2));
  if (has(R.soundTypes).length) set("UserInteractivity", 3, fmt(has(R.soundTypes)));

  // Data Representation
  if (has(R.actorProps).length) set("DataRepresentation", 1, fmt(has(R.actorProps)));
  if (has(R.variableOps).length) set("DataRepresentation", 2, fmt(has(R.variableOps)));
  if (has(R.listOps).length) set("DataRepresentation", 3, fmt(has(R.listOps)));

  // Flow Control
  const actions = nb.filter((b) => b.comp === "ActionRobot");
  if (actions.length >= 2) set("FlowControl", 1, `동작 블록 ${actions.length}개 순서 배치`);
  if (has(R.loops).length) set("FlowControl", 2, fmt(has(R.loops)));
  if (has(R.repeatUntil).length) set("FlowControl", 3, fmt(has(R.repeatUntil)));

  // Synchronization
  if (has(R.wait).length) set("Synchronization", 1, fmt(has(R.wait)));
  if (has(R.sayWithTime).length) set("Synchronization", 2, fmt(has(R.sayWithTime)));
  if (has(R.waitUntil).length) set("Synchronization", 3, fmt(has(R.waitUntil)));

  // Operators
  const opKey = (b) => b.type === "conditionAndOr" ? `conditionAndOr:${b.values.andType || ""}` : b.type;
  const groups = Object.entries(R.operatorGroups)
    .filter(([g, list]) => nb.some((b) => list.includes(opKey(b))) ||
      (g === "산술" && R.sumValueAsArithmetic && nb.some((b) => b.type === "SumValue")))
    .map(([g]) => g);
  const n = groups.length;
  if (n) set("Operators", n >= 3 ? 3 : n, `${n}종류: ${groups.join(", ")}`);

  const total = Object.values(S).reduce((a, b) => a + b, 0);
  return { scores: S, evidence: E, total };
}

/* ---------- 6. 화면 ---------- */
const CRITERIA = [
  ["Abstraction", "Abstraction"], ["Logic", "Logic"], ["Parallelism", "Parallelism"],
  ["UserInteractivity", "User Interactivity"], ["DataRepresentation", "Data Representation"],
  ["FlowControl", "Flow Control"], ["Synchronization", "Synchronization"], ["Operators", "Operators"],
];
const state = { teacher: null, teacherName: "", results: [] };

async function readFile(file) { return new Uint8Array(await file.arrayBuffer()); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n"; el.scrollTop = el.scrollHeight;
}

async function loadTeacher(file) {
  try {
    state.teacher = extractBlocks(await readFile(file));
    state.teacherName = file.name;
    document.getElementById("teacherName").textContent = `${file.name} 불러옴 (블록 ${state.teacher.size}개)`;
    log(`[교사] ${file.name}: 블록 ${state.teacher.size}개`);
    if (state.results.length) rescoreAll();
  } catch (e) { log(`[오류] 교사 파일을 읽지 못했습니다: ${e.message}`); }
}

async function addStudents(files) {
  for (const file of files) {
    try {
      const blocks = extractBlocks(await readFile(file));
      state.results.push({ name: file.name.replace(/\.mod$/i, ""), blocks });
      log(`[학생] ${file.name}: 블록 ${blocks.size}개`);
    } catch (e) { log(`[오류] ${file.name}: ${e.message}`); }
  }
  rescoreAll();
}

function rescoreAll() {
  const useTemplate = document.getElementById("modeDiff").checked;
  if (useTemplate && !state.teacher && state.results.length)
    log("[안내] 교사 템플릿이 없어 전체 프로젝트 기준으로 채점합니다.");
  state.results.forEach((r) => {
    const t = useTemplate ? state.teacher : null;
    r.added = newBlocks(t, r.blocks);
    Object.assign(r, scoreBlocks(r.added, r.blocks));
  });
  render();
}

function render() {
  const body = document.getElementById("resultBody");
  if (!state.results.length) {
    body.innerHTML = '<tr class="empty"><td colspan="12">학생 파일을 올리면 결과가 여기에 표시됩니다.</td></tr>';
    document.getElementById("csvBtn").disabled = true;
    document.getElementById("count").textContent = "";
    return;
  }
  body.innerHTML = state.results.map((r, i) => `
    <tr>
      <td class="name">${esc(r.name)}</td>
      ${CRITERIA.map(([k]) => `<td class="score s${r.scores[k]}" title="${esc(r.evidence[k] || "해당 블록 없음")}">${r.scores[k]}</td>`).join("")}
      <td class="total">${r.total}</td>
      <td>${r.added.length}</td>
      <td><button class="link" data-i="${i}">근거 보기</button></td>
    </tr>`).join("");
  body.querySelectorAll("button.link").forEach((b) => b.addEventListener("click", () => showDetail(+b.dataset.i)));
  document.getElementById("csvBtn").disabled = !state.results.length;
  document.getElementById("count").textContent = state.results.length ? `${state.results.length}명` : "";
}

function showDetail(i) {
  const r = state.results[i];
  const rows = CRITERIA.map(([k, label]) =>
    `<tr><th>${label}</th><td class="score s${r.scores[k]}">${r.scores[k]}</td><td>${esc(r.evidence[k] || "해당 블록 없음")}</td></tr>`).join("");
  const list = r.added.length
    ? r.added.map((b) => `<li><code>${esc(b.comp)}</code> ${esc(LABELS[b.type] || b.type || "")} <span class="path">${esc(b.path)}</span></li>`).join("")
    : "<li>새로 추가한 블록이 없습니다.</li>";
  document.getElementById("detail").innerHTML = `
    <h3>${esc(r.name)} 학생, 총점 ${r.total}/24</h3>
    <table class="evidence">${rows}</table>
    <details><summary>새로 추가된 블록 ${r.added.length}개</summary><ul>${list}</ul></details>`;
  document.getElementById("detail").hidden = false;
}

function downloadCSV() {
  const head = ["student", ...CRITERIA.map(([, l]) => l), "Total", "NewBlocks",
    ...CRITERIA.map(([, l]) => l + " evidence")];
  const lines = [head, ...state.results.map((r) => [r.name, ...CRITERIA.map(([k]) => r.scores[k]),
    r.total, r.added.length, ...CRITERIA.map(([k]) => r.evidence[k] || "")])]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "ct_scores.csv"; a.click();
}

function wireDrop(zoneId, inputId, handler, multiple) {
  const zone = document.getElementById(zoneId), input = document.getElementById(inputId);
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => { handler(multiple ? [...input.files] : input.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (ev) => {
    const files = [...ev.dataTransfer.files].filter((f) => /\.mod$/i.test(f.name));
    if (!files.length) return log("[안내] .mod 파일만 올릴 수 있습니다.");
    handler(multiple ? files : files[0]);
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
}
let inited = false;
function init() {
  if (inited) return; inited = true;
  wireDrop("teacherZone", "teacherInput", loadTeacher, false);
  wireDrop("studentZone", "studentInput", addStudents, true);
  document.getElementById("csvBtn").addEventListener("click", downloadCSV);
  document.getElementById("clearBtn").addEventListener("click", () => {
    state.results = []; document.getElementById("detail").hidden = true; render(); log("[초기화] 학생 결과를 지웠습니다.");
  });
  document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", rescoreAll));
}

/* Node 테스트용 */
if (typeof module !== "undefined") module.exports = { extractBlocks, newBlocks, scoreBlocks };