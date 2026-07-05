const TOKYO_STATION = [35.681236, 139.767125];
const SOURCE_TEXT = "出典：国土地理院地図を加工して作成";
const DID_SOURCE_TEXT = "人口集中地区（令和2年 総務省統計局）";
const AIRPORT_SOURCE_TEXT = "空港等の周辺空域（航空局）";
const DRONE_LAW_SOURCE_TEXT = "小型無人機等飛行禁止法対象施設周辺地域（警察庁・関係府省庁等）";
const DEFAULT_TITLE = document.title;
const ADDRESS_SEARCH_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";
const FORM_STORAGE_KEY = "drone-map-form-v1";

const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true
}).setView(TOKYO_STATION, 16);

map.createPane("restrictionPane");
map.getPane("restrictionPane").style.zIndex = 350;

L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

const tileLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  maxZoom: 18,
  minZoom: 5,
  crossOrigin: "anonymous",
  attribution: SOURCE_TEXT
}).addTo(map);

const didLayer = L.tileLayer("https://maps.gsi.go.jp/xyz/did2020/{z}/{x}/{y}.png", {
  maxZoom: 18,
  minZoom: 8,
  crossOrigin: "anonymous",
  opacity: 0.58,
  attribution: DID_SOURCE_TEXT
}).addTo(map);

const airportLayer = L.geoJSON(null, {
  pane: "restrictionPane",
  style: {
    color: "#16803a",
    weight: 2,
    opacity: 0.9,
    fillColor: "#5ec269",
    fillOpacity: 0.28
  }
}).addTo(map);

const droneYellowLayer = L.geoJSON(null, {
  pane: "restrictionPane",
  style: {
    color: "#a66b00",
    weight: 2,
    opacity: 0.92,
    fillColor: "#ffcc00",
    fillOpacity: 0.24
  }
});

const droneRedLayer = L.geoJSON(null, {
  pane: "restrictionPane",
  style: {
    color: "#b42318",
    weight: 2,
    opacity: 0.95,
    fillColor: "#da2d2d",
    fillOpacity: 0.34
  }
});

// 改正法（令和8年7月14日施行）対応：地理院地図の
// 「【令和8年7月14日以降】対象施設周辺地域（レッドゾーン＋イエローゾーン）」レイヤー。
// 地理院地図上のレイヤーIDは drone_rz_yz_2607。
// タイル形式（GeoJSON / PNG）は起動時に探査して自動判別する。
const NEW_LAW_GEOJSON_TEMPLATE = "https://maps.gsi.go.jp/xyz/drone_rz_yz_2607/{z}/{x}/{y}.geojson";
const NEW_LAW_PNG_TEMPLATE = "https://maps.gsi.go.jp/xyz/drone_rz_yz_2607/{z}/{x}/{y}.png";
// 東京都心（皇居周辺）のズーム8タイル。対象施設が必ず存在するため探査に使う。
const NEW_LAW_PROBE_GEOJSON = "https://maps.gsi.go.jp/xyz/drone_rz_yz_2607/8/227/100.geojson";
const NEW_LAW_PROBE_PNG = "https://maps.gsi.go.jp/xyz/drone_rz_yz_2607/8/227/100.png";

// GeoJSON配信だった場合に使う分類済みレイヤー（凡例・重ね順は既存の黄・赤と揃える）
const newLawYellowLayer = L.geoJSON(null, {
  pane: "restrictionPane",
  style: {
    color: "#a66b00",
    weight: 2,
    opacity: 0.92,
    dashArray: "6 4",
    fillColor: "#ffcc00",
    fillOpacity: 0.24
  }
});

const newLawRedLayer = L.geoJSON(null, {
  pane: "restrictionPane",
  style: {
    color: "#b42318",
    weight: 2,
    opacity: 0.95,
    dashArray: "6 4",
    fillColor: "#da2d2d",
    fillOpacity: 0.34
  }
});

// PNG配信だった場合に使うラスタオーバーレイ
const newLawPngLayer = L.tileLayer(NEW_LAW_PNG_TEMPLATE, {
  maxZoom: 18,
  minZoom: 8,
  maxNativeZoom: 16,
  crossOrigin: "anonymous",
  opacity: 0.6
});

const newLawLayer = L.layerGroup([newLawYellowLayer, newLawRedLayer]).addTo(map);

const droneLawLayer = L.layerGroup([droneYellowLayer, droneRedLayer]).addTo(map);

const airportTileCache = new Map();
const droneLawTileCache = new Map();
const newLawTileCache = new Map();
let airportRequestId = 0;
let droneLawRequestId = 0;
let newLawRequestId = 0;
// "geojson" / "png" / "none" のいずれか（起動時に1回だけ探査）
let newLawSourceModePromise = null;

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

L.drawLocal.draw.toolbar.buttons.polygon = "飛行範囲を描く";
L.drawLocal.draw.toolbar.actions.title = "描画をキャンセル";
L.drawLocal.draw.toolbar.actions.text = "キャンセル";
L.drawLocal.draw.toolbar.finish.title = "描画を完了";
L.drawLocal.draw.toolbar.finish.text = "完了";
L.drawLocal.draw.toolbar.undo.title = "最後の点を取り消す";
L.drawLocal.draw.toolbar.undo.text = "1点戻す";
L.drawLocal.draw.handlers.polygon.tooltip.start = "地図をタップして飛行範囲を描き始めます。";
L.drawLocal.draw.handlers.polygon.tooltip.cont = "次の点をタップします。";
L.drawLocal.draw.handlers.polygon.tooltip.end = "最初の点をタップして範囲を閉じます。";
L.drawLocal.edit.toolbar.buttons.edit = "飛行範囲を編集";
L.drawLocal.edit.toolbar.buttons.editDisabled = "編集できる飛行範囲がありません";
L.drawLocal.edit.toolbar.buttons.remove = "飛行範囲を削除";
L.drawLocal.edit.toolbar.buttons.removeDisabled = "削除できる飛行範囲がありません";
L.drawLocal.edit.toolbar.actions.save.title = "変更を保存";
L.drawLocal.edit.toolbar.actions.save.text = "保存";
L.drawLocal.edit.toolbar.actions.cancel.title = "編集をキャンセル";
L.drawLocal.edit.toolbar.actions.cancel.text = "キャンセル";
L.drawLocal.edit.toolbar.actions.clearAll.title = "すべて削除";
L.drawLocal.edit.toolbar.actions.clearAll.text = "すべて削除";
L.drawLocal.edit.handlers.edit.tooltip.text = "点をドラッグして飛行範囲を編集します。";
L.drawLocal.edit.handlers.edit.tooltip.subtext = "キャンセルで変更を戻します。";
L.drawLocal.edit.handlers.remove.tooltip.text = "削除する飛行範囲をタップします。";

let takeoffMarker = null;
let takeoffMode = false;
let flightDrawMode = false;
let flightDrawPoints = [];
let flightPreviewLayer = null;
let statusTimer = null;
let isPrinting = false;
let labelsVisible = true;
let printViewState = null;
let previousDocumentTitle = DEFAULT_TITLE;
let searchMarker = null;
let locationWatchId = null;
let locationMarker = null;
let locationAccuracyCircle = null;
let followLocation = false;
// やり直し用の操作履歴。要素は
// { type: "takeoff", previousLatLng } または { type: "flightArea", layer }
const actionHistory = [];

const takeoffIcon = L.divIcon({
  className: "takeoff-marker",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14]
});

const searchIcon = L.divIcon({
  className: "search-marker",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -11]
});

const currentLocationIcon = L.divIcon({
  className: "current-location-marker",
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

const polygonOptions = {
  allowIntersection: false,
  showArea: true,
  shapeOptions: {
    color: "#145fb3",
    weight: 5,
    opacity: 0.95,
    fillColor: "#2f80d0",
    fillOpacity: 0.28
  }
};

const drawControl = new L.Control.Draw({
  position: "topleft",
  draw: {
    polyline: false,
    rectangle: false,
    circle: false,
    marker: false,
    circlemarker: false,
    polygon: polygonOptions
  },
  edit: {
    featureGroup: drawnItems,
    edit: true,
    remove: true
  }
});

map.addControl(drawControl);

const polygonDrawer = new L.Draw.Polygon(map, polygonOptions);
const elements = {
  locate: document.getElementById("locate-btn"),
  takeoff: document.getElementById("takeoff-btn"),
  draw: document.getElementById("draw-btn"),
  undo: document.getElementById("undo-btn"),
  jpeg: document.getElementById("jpeg-btn"),
  pdf: document.getElementById("pdf-btn"),
  clear: document.getElementById("clear-btn"),
  didLayer: document.getElementById("did-layer-toggle"),
  airportLayer: document.getElementById("airport-layer-toggle"),
  droneLawLayer: document.getElementById("drone-law-layer-toggle"),
  newLawLayer: document.getElementById("new-law-layer-toggle"),
  labels: document.getElementById("label-toggle"),
  status: document.getElementById("status-message"),
  createdAt: document.getElementById("created-at"),
  printCreatedAt: document.getElementById("print-created-at-title"),
  addressInput: document.getElementById("address-input"),
  addressSearch: document.getElementById("address-search-btn"),
  searchResults: document.getElementById("search-results"),
  printFields: {
    coverageName: document.getElementById("print-coverage-name"),
    shootingDate: document.getElementById("print-shooting-date"),
    place: document.getElementById("print-place"),
    pilot: document.getElementById("print-pilot"),
    assistant: document.getElementById("print-assistant"),
    notes: document.getElementById("print-notes")
  },
  inputs: [
    document.getElementById("coverage-name"),
    document.getElementById("shooting-date"),
    document.getElementById("place"),
    document.getElementById("pilot"),
    document.getElementById("assistant"),
    document.getElementById("notes")
  ]
};

/* ---------- フォーム自動保存（localStorage） ---------- */

function saveFormToStorage() {
  try {
    const values = elements.inputs.map((input) => input.value);
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(values));
  } catch (error) {
    // プライベートモード等で失敗しても動作は継続する
  }
}

function restoreFormFromStorage() {
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY);
    if (!raw) return;
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) return;
    elements.inputs.forEach((input, index) => {
      if (typeof values[index] === "string") {
        input.value = values[index];
      }
    });
  } catch (error) {
    // 破損データは無視
  }
}

function clearFormStorage() {
  try {
    localStorage.removeItem(FORM_STORAGE_KEY);
  } catch (error) {
    // 無視
  }
}

/* ---------- 出力タイトル・印刷情報 ---------- */

function formatDateForFilename(value) {
  if (value) {
    return value.replaceAll("-", "");
  }

  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
}

function formatDateForPrint(value) {
  if (!value) return "";
  return value.replaceAll("-", "/");
}

function sanitizeFilenamePart(value) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "");
}

function buildOutputTitle() {
  const shootingDate = elements.inputs[1].value;
  const coverageName = sanitizeFilenamePart(elements.inputs[0].value || "ドローン飛行範囲図");
  const pilot = sanitizeFilenamePart(elements.inputs[3].value || "操縦者未入力");
  return `${formatDateForFilename(shootingDate)}${coverageName}（${pilot}）`;
}

function refreshPrintInfo() {
  elements.printFields.coverageName.textContent = elements.inputs[0].value || "未入力";
  elements.printFields.shootingDate.textContent = formatDateForPrint(elements.inputs[1].value) || "未入力";
  elements.printFields.place.textContent = elements.inputs[2].value || "未入力";
  elements.printFields.pilot.textContent = elements.inputs[3].value || "未入力";
  elements.printFields.assistant.textContent = elements.inputs[4].value || "未入力";
  elements.printFields.notes.textContent = elements.inputs[5].value || "なし";
}

function setPdfDocumentTitle() {
  previousDocumentTitle = document.title;
  document.title = buildOutputTitle();
}

function restoreDocumentTitle() {
  document.title = previousDocumentTitle || DEFAULT_TITLE;
}

/* ---------- レイヤー表示 ---------- */

function setTileOverlay(layer, enabled) {
  if (enabled) {
    if (!map.hasLayer(layer)) {
      map.addLayer(layer);
    }
    return;
  }

  if (map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
}

function setLabelsVisible(enabled) {
  labelsVisible = enabled;
  document.body.classList.toggle("map-labels-hidden", !enabled);
}

function bindTakeoffLabel(marker) {
  marker.bindTooltip("離陸地点", {
    permanent: true,
    direction: "right",
    offset: [16, 0],
    className: "map-label takeoff-label"
  });
}

function bindFlightAreaLabel(layer) {
  layer.bindTooltip("飛行範囲", {
    permanent: true,
    direction: "center",
    className: "map-label flight-label"
  });
}

function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  const scale = 2 ** zoom;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale);
}

function lngToTileX(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * (2 ** zoom));
}

async function loadAirportRestrictions() {
  airportRequestId += 1;
  const requestId = airportRequestId;

  if (!map.hasLayer(airportLayer) || map.getZoom() < 8) {
    airportLayer.clearLayers();
    return;
  }

  const zoom = 8;
  const bounds = map.getBounds();
  const northWest = bounds.getNorthWest();
  const southEast = bounds.getSouthEast();
  const minX = lngToTileX(northWest.lng, zoom);
  const maxX = lngToTileX(southEast.lng, zoom);
  const minY = latToTileY(northWest.lat, zoom);
  const maxY = latToTileY(southEast.lat, zoom);
  const requests = [];

  airportLayer.clearLayers();

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const key = `${zoom}/${x}/${y}`;
      if (!airportTileCache.has(key)) {
        const url = `https://maps.gsi.go.jp/xyz/kokuarea/${key}.geojson`;
        airportTileCache.set(
          key,
          fetch(url)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null)
        );
      }

      requests.push(airportTileCache.get(key));
    }
  }

  const features = await Promise.all(requests);
  if (requestId !== airportRequestId || !map.hasLayer(airportLayer)) {
    return;
  }

  airportLayer.clearLayers();
  features.filter(Boolean).forEach((geojson) => airportLayer.addData(geojson));
}

/*
 * 改正法レイヤー（drone_rz_yz_2607）の配信形式を起動時に1回だけ探査する。
 * 皇居周辺のタイルは対象施設を必ず含むため、両形式とも404なら未配信と判断する。
 */
function detectNewLawSource() {
  if (!newLawSourceModePromise) {
    newLawSourceModePromise = fetch(NEW_LAW_PROBE_GEOJSON)
      .then((response) => {
        if (response.ok) return "geojson";
        return fetch(NEW_LAW_PROBE_PNG, { method: "HEAD" })
          .then((pngResponse) => (pngResponse.ok ? "png" : "none"))
          .catch(() => "none");
      })
      .catch(() => "none")
      .then((mode) => {
        if (mode === "none") {
          showStatus("改正法レイヤー（drone_rz_yz_2607）を取得できませんでした。配信状況を地理院地図で確認してください。");
        }
        return mode;
      });
  }
  return newLawSourceModePromise;
}

/*
 * 統合タイルの各フィーチャをレッド/イエローに分類する。
 * 1. プロパティの文字列に「レッド」「イエロー」等が含まれればそれに従う
 * 2. 地理院GeoJSONのスタイル属性（_color/_fillColor）があれば色味で判定
 * 3. どちらも不明な場合はイエロー扱い（安全側：規制ありとして表示）
 */
function classifyDroneLawFeature(feature) {
  const props = feature?.properties || {};
  const raw = JSON.stringify(props);

  if (/レッド|red/i.test(raw)) return "red";
  if (/イエロー|yellow/i.test(raw)) return "yellow";

  const colorHex = String(props._fillColor || props._color || "");
  const match = colorHex.match(/^#?([0-9a-f]{6})$/i);
  if (match) {
    const r = parseInt(match[1].slice(0, 2), 16);
    const g = parseInt(match[1].slice(2, 4), 16);
    if (r > 150 && g < 120) return "red";
    return "yellow";
  }

  return "yellow";
}

async function loadDroneLawRestrictions() {
  droneLawRequestId += 1;
  const requestId = droneLawRequestId;

  if (!map.hasLayer(droneLawLayer) || map.getZoom() < 8) {
    droneYellowLayer.clearLayers();
    droneRedLayer.clearLayers();
    return;
  }

  const zoom = 8;
  const bounds = map.getBounds();
  const northWest = bounds.getNorthWest();
  const southEast = bounds.getSouthEast();
  const minX = lngToTileX(northWest.lng, zoom);
  const maxX = lngToTileX(southEast.lng, zoom);
  const minY = latToTileY(northWest.lat, zoom);
  const maxY = latToTileY(southEast.lat, zoom);
  const requests = [];

  droneYellowLayer.clearLayers();
  droneRedLayer.clearLayers();

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      [
        ["yellow", "https://maps.gsi.go.jp/xyz/drone_yz/{z}/{x}/{y}.geojson"],
        ["red", "https://maps.gsi.go.jp/xyz/drone_rz/{z}/{x}/{y}.geojson"]
      ].forEach(([type, template]) => {
        const key = `${type}/${zoom}/${x}/${y}`;
        if (!droneLawTileCache.has(key)) {
          const url = template
            .replace("{z}", zoom)
            .replace("{x}", x)
            .replace("{y}", y);
          droneLawTileCache.set(
            key,
            fetch(url)
              .then((response) => (response.ok ? response.json() : null))
              .catch(() => null)
          );
        }

        requests.push(
          droneLawTileCache.get(key).then((geojson) => ({ type, geojson }))
        );
      });
    }
  }

  const features = await Promise.all(requests);
  if (requestId !== droneLawRequestId || !map.hasLayer(droneLawLayer)) {
    return;
  }

  droneYellowLayer.clearLayers();
  droneRedLayer.clearLayers();
  features.forEach(({ type, geojson }) => {
    if (!geojson) return;
    if (type === "red") {
      droneRedLayer.addData(geojson);
      return;
    }
    droneYellowLayer.addData(geojson);
  });
  droneYellowLayer.bringToFront();
  droneRedLayer.bringToFront();
}

/*
 * 改正法（7/14以降）レイヤーの読み込み。
 * GeoJSON配信ならフィーチャを黄・赤に分類してベクタ描画、
 * PNG配信ならラスタオーバーレイとして重ねる。
 */
async function loadNewLawRestrictions() {
  newLawRequestId += 1;
  const requestId = newLawRequestId;

  if (!map.hasLayer(newLawLayer) || map.getZoom() < 8) {
    newLawYellowLayer.clearLayers();
    newLawRedLayer.clearLayers();
    return;
  }

  const mode = await detectNewLawSource();
  if (requestId !== newLawRequestId || !map.hasLayer(newLawLayer)) {
    return;
  }

  if (mode === "png") {
    // ラスタ配信：タイルレイヤーを一度だけグループに加えれば以後はLeafletが管理する
    if (!newLawLayer.hasLayer(newLawPngLayer)) {
      newLawLayer.addLayer(newLawPngLayer);
    }
    return;
  }

  if (mode !== "geojson") {
    return;
  }

  const zoom = 8;
  const bounds = map.getBounds();
  const northWest = bounds.getNorthWest();
  const southEast = bounds.getSouthEast();
  const minX = lngToTileX(northWest.lng, zoom);
  const maxX = lngToTileX(southEast.lng, zoom);
  const minY = latToTileY(northWest.lat, zoom);
  const maxY = latToTileY(southEast.lat, zoom);
  const requests = [];

  newLawYellowLayer.clearLayers();
  newLawRedLayer.clearLayers();

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const key = `${zoom}/${x}/${y}`;
      if (!newLawTileCache.has(key)) {
        const url = NEW_LAW_GEOJSON_TEMPLATE
          .replace("{z}", zoom)
          .replace("{x}", x)
          .replace("{y}", y);
        newLawTileCache.set(
          key,
          fetch(url)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null)
        );
      }

      requests.push(newLawTileCache.get(key));
    }
  }

  const tiles = await Promise.all(requests);
  if (requestId !== newLawRequestId || !map.hasLayer(newLawLayer)) {
    return;
  }

  newLawYellowLayer.clearLayers();
  newLawRedLayer.clearLayers();

  tiles.filter(Boolean).forEach((geojson) => {
    const featureList = geojson.type === "FeatureCollection" ? geojson.features : [geojson];
    (featureList || []).forEach((feature) => {
      if (classifyDroneLawFeature(feature) === "red") {
        newLawRedLayer.addData(feature);
      } else {
        newLawYellowLayer.addData(feature);
      }
    });
  });

  newLawYellowLayer.bringToFront();
  newLawRedLayer.bringToFront();
}

/* ---------- 住所検索（国土地理院 住所検索API） ---------- */

function hideSearchResults() {
  elements.searchResults.hidden = true;
  elements.searchResults.innerHTML = "";
}

function placeSearchMarker(latlng, title) {
  if (searchMarker) {
    map.removeLayer(searchMarker);
  }
  searchMarker = L.marker(latlng, { icon: searchIcon })
    .addTo(map)
    .bindPopup(title || "検索地点");
}

function selectSearchResult(latlng, title) {
  hideSearchResults();
  map.setView(latlng, Math.max(map.getZoom(), 16));
  placeSearchMarker(latlng, title);
  showStatus(`「${title}」へ移動しました。マーカーは全消去で削除できます。`);
}

function renderSearchResults(results) {
  elements.searchResults.innerHTML = "";

  results.slice(0, 5).forEach((result) => {
    const [lng, lat] = result.geometry.coordinates;
    const title = result.properties?.title || "名称不明";
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = title;
    button.addEventListener("click", () => {
      selectSearchResult([lat, lng], title);
    });
    item.appendChild(button);
    elements.searchResults.appendChild(item);
  });

  elements.searchResults.hidden = false;
}

async function searchAddress() {
  const query = elements.addressInput.value.trim();
  if (!query) {
    showStatus("住所または地名を入力してください。");
    return;
  }

  elements.addressSearch.disabled = true;
  showStatus("住所を検索しています。");

  try {
    const response = await fetch(ADDRESS_SEARCH_URL + encodeURIComponent(query));
    if (!response.ok) {
      throw new Error(`Address search failed: ${response.status}`);
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      hideSearchResults();
      showStatus("該当する場所が見つかりませんでした。表記を変えてお試しください。");
      return;
    }

    if (results.length === 1) {
      const [lng, lat] = results[0].geometry.coordinates;
      selectSearchResult([lat, lng], results[0].properties?.title || query);
      return;
    }

    renderSearchResults(results);
    showStatus(`候補が${Math.min(results.length, 5)}件見つかりました。移動先をタップしてください。`);
  } catch (error) {
    console.error(error);
    hideSearchResults();
    showStatus("住所検索に失敗しました。通信状態を確認して再度お試しください。");
  } finally {
    elements.addressSearch.disabled = false;
  }
}

/* ---------- 共通UI ---------- */

function formatDateTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function refreshCreatedAt() {
  const text = `作成日時：${formatDateTime(new Date())}`;
  elements.createdAt.textContent = text;
  elements.printCreatedAt.textContent = text;
}

function showStatus(message) {
  window.clearTimeout(statusTimer);
  elements.status.textContent = message;
  elements.status.classList.add("visible");
  statusTimer = window.setTimeout(() => {
    elements.status.classList.remove("visible");
  }, 4500);
}

function redrawMapForCurrentLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        resolve();
      });
    });
  });
}

function waitForVisibleTiles(timeout = 5000) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    function isReady() {
      const tiles = Array.from(document.querySelectorAll(".leaflet-tile"));
      const visibleTiles = tiles.filter((tile) => {
        const rect = tile.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      return visibleTiles.length > 0 && visibleTiles.every((tile) => (
        tile.classList.contains("leaflet-tile-error")
          || (tile.complete && tile.naturalWidth > 0 && !tile.classList.contains("leaflet-tile-loading"))
      ));
    }

    function check() {
      if (isReady() || Date.now() - startedAt >= timeout) {
        resolve();
        return;
      }

      window.setTimeout(check, 100);
    }

    check();
  });
}

async function preparePrintLayout() {
  isPrinting = true;
  printViewState = {
    center: map.getCenter(),
    zoom: map.getZoom()
  };
  refreshCreatedAt();
  refreshPrintInfo();
  setPdfDocumentTitle();
  setTakeoffMode(false);
  polygonDrawer.disable();
  hideSearchResults();
  document.body.classList.add("print-preparing");
  await redrawMapForCurrentLayout();
  if (takeoffMarker) {
    map.setView(takeoffMarker.getLatLng(), map.getZoom(), { animate: false });
    await redrawMapForCurrentLayout();
  }
  await loadAirportRestrictions();
  await loadDroneLawRestrictions();
  await loadNewLawRestrictions();
  await waitForVisibleTiles();
  await redrawMapForCurrentLayout();
  await waitForVisibleTiles();
}

async function restoreScreenLayout() {
  isPrinting = false;
  document.body.classList.remove("print-preparing");
  restoreDocumentTitle();
  if (printViewState) {
    map.setView(printViewState.center, printViewState.zoom, { animate: false });
    printViewState = null;
  }
  await redrawMapForCurrentLayout();
  await loadAirportRestrictions();
  await loadDroneLawRestrictions();
  await loadNewLawRestrictions();
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

async function shareBlobIfAvailable(blob, filename, type) {
  const file = new File([blob], filename, { type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: filename
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        console.warn("File sharing failed.", error);
      }
    }
  }
}

async function saveExportBlob(blob, filename, type, { shareOnAndroid = false } = {}) {
  saveBlob(blob, filename);

  if (isAndroid() && shareOnAndroid) {
    await shareBlobIfAvailable(blob, filename, type);
  }
}

async function renderExportCanvas() {
  await preparePrintLayout();

  const target = document.body;
  return window.html2canvas(target, {
    backgroundColor: "#ffffff",
    scale: Math.min(window.devicePixelRatio || 1, 2),
    useCORS: true,
    allowTaint: false,
    logging: false,
    windowWidth: target.scrollWidth,
    windowHeight: target.scrollHeight
  });
}

function setExportButtonsDisabled(disabled, activeButton, label) {
  elements.jpeg.disabled = disabled;
  elements.pdf.disabled = disabled;
  if (activeButton) {
    activeButton.textContent = disabled ? "作成中" : label;
  }
}

async function downloadJpeg() {
  if (!window.html2canvas) {
    showStatus("画像生成ライブラリを読み込めませんでした。通信状態を確認して再度お試しください。");
    return;
  }

  setExportButtonsDisabled(true, elements.jpeg, "JPEG保存");
  showStatus("JPEGを作成しています。地図タイルの読み込みを待っています。");

  try {
    const canvas = await renderExportCanvas();

    await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("JPEG blob was not created."));
          return;
        }

        saveExportBlob(blob, `${buildOutputTitle()}.jpg`, "image/jpeg", { shareOnAndroid: true })
          .then(resolve)
          .catch(reject);
      }, "image/jpeg", 0.95);
    });
    showStatus("JPEGをダウンロードしました。AndroidではフォトアプリやTeams共有も確認できます。");
  } catch (error) {
    console.error(error);
    showStatus("JPEGの作成に失敗しました。地図を少し動かしてから再度お試しください。");
  } finally {
    await restoreScreenLayout();
    setExportButtonsDisabled(false, elements.jpeg, "JPEG保存");
  }
}

async function downloadPdf() {
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    showStatus("PDF生成ライブラリを読み込めませんでした。通信状態を確認して再度お試しください。");
    return;
  }

  setExportButtonsDisabled(true, elements.pdf, "PDF保存");
  showStatus("PDFを作成しています。地図タイルの読み込みを待っています。");

  try {
    const canvas = await renderExportCanvas();
    const pdf = new window.jspdf.jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true
    });
    const pageWidth = 210;
    const pageHeight = 297;
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    const fittedHeight = Math.min(imageHeight, pageHeight);
    const fittedWidth = imageHeight > pageHeight
      ? (canvas.width * fittedHeight) / canvas.height
      : imageWidth;
    const x = (pageWidth - fittedWidth) / 2;

    pdf.addImage(
      canvas.toDataURL("image/jpeg", 0.95),
      "JPEG",
      x,
      0,
      fittedWidth,
      fittedHeight,
      undefined,
      "FAST"
    );
    const blob = pdf.output("blob");
    await saveExportBlob(blob, `${buildOutputTitle()}.pdf`, "application/pdf", { shareOnAndroid: true });
    showStatus("PDFをダウンロードしました。Androidでは共有先にTeamsも選択できます。");
  } catch (error) {
    console.error(error);
    showStatus("PDFの作成に失敗しました。地図を少し動かしてから再度お試しください。");
  } finally {
    await restoreScreenLayout();
    setExportButtonsDisabled(false, elements.pdf, "PDF保存");
  }
}

/* ---------- 離陸場所・飛行範囲の描画 ---------- */

function setTakeoffMode(enabled) {
  takeoffMode = enabled;
  elements.takeoff.classList.toggle("active", enabled);
  if (enabled) {
    setFlightDrawMode(false);
  }
  map.getContainer().style.cursor = enabled || flightDrawMode ? "crosshair" : "";
}

function placeTakeoffMarker(latlng, { recordHistory = true } = {}) {
  const previousLatLng = takeoffMarker ? takeoffMarker.getLatLng() : null;

  if (takeoffMarker) {
    map.removeLayer(takeoffMarker);
  }
  takeoffMarker = L.marker(latlng, { icon: takeoffIcon, draggable: true })
    .addTo(map)
    .bindPopup("離陸地点");
  bindTakeoffLabel(takeoffMarker);
  takeoffMarker.on("dragend", () => {
    showStatus("離陸地点を移動しました。");
  });

  if (recordHistory) {
    actionHistory.push({ type: "takeoff", previousLatLng });
  }
}

function removeFlightPreview() {
  if (flightPreviewLayer) {
    map.removeLayer(flightPreviewLayer);
    flightPreviewLayer = null;
  }
}

function setFlightDrawMode(enabled) {
  flightDrawMode = enabled;
  elements.draw.classList.toggle("active", enabled);
  map.getContainer().style.cursor = takeoffMode || enabled ? "crosshair" : "";

  if (!enabled) {
    flightDrawPoints = [];
    removeFlightPreview();
  }
}

function updateFlightPreview() {
  if (flightDrawPoints.length === 0) {
    removeFlightPreview();
    return;
  }

  if (!flightPreviewLayer) {
    flightPreviewLayer = L.polyline(flightDrawPoints, polygonOptions.shapeOptions).addTo(map);
  } else {
    flightPreviewLayer.setLatLngs(flightDrawPoints);
  }
}

function addFlightDrawPoint(latlng) {
  flightDrawPoints.push(latlng);
  updateFlightPreview();

  if (flightDrawPoints.length < 3) {
    showStatus(`飛行範囲の${flightDrawPoints.length}点目を指定しました。3点以上タップしてください。`);
    return;
  }

  showStatus("3点以上指定済みです。飛行範囲を描くボタンをもう一度押すと確定します。");
}

function finishFlightDraw() {
  if (flightDrawPoints.length < 3) {
    showStatus("飛行範囲は3点以上指定してください。");
    return;
  }

  const layer = L.polygon(flightDrawPoints, polygonOptions.shapeOptions);
  bindFlightAreaLabel(layer);
  drawnItems.addLayer(layer);
  actionHistory.push({ type: "flightArea", layer });
  setFlightDrawMode(false);
  showStatus("飛行範囲を追加しました。「戻す」で取り消せます。");
}

/*
 * 「戻す」ボタン。文脈に応じて次の順で1手戻す。
 * 1. 飛行範囲の描画中 → 直前にタップした点を1つ削除
 * 2. それ以外 → 操作履歴の最後（飛行範囲の確定 or 離陸場所の指定）を取り消す
 */
function undoLastAction() {
  if (flightDrawMode && flightDrawPoints.length > 0) {
    flightDrawPoints.pop();
    updateFlightPreview();
    if (flightDrawPoints.length === 0) {
      showStatus("すべての点を取り消しました。描画モードは継続中です。地図をタップして描き直せます。");
    } else {
      showStatus(`1点戻しました。現在${flightDrawPoints.length}点です。`);
    }
    return;
  }

  const lastAction = actionHistory.pop();
  if (!lastAction) {
    showStatus("戻せる操作がありません。");
    return;
  }

  if (lastAction.type === "flightArea") {
    if (drawnItems.hasLayer(lastAction.layer)) {
      drawnItems.removeLayer(lastAction.layer);
      showStatus("最後に確定した飛行範囲を取り消しました。");
    } else {
      // 編集ツールで既に削除済みなら次の履歴へ
      undoLastAction();
    }
    return;
  }

  if (lastAction.type === "takeoff") {
    if (takeoffMarker) {
      map.removeLayer(takeoffMarker);
      takeoffMarker = null;
    }
    if (lastAction.previousLatLng) {
      placeTakeoffMarker(lastAction.previousLatLng, { recordHistory: false });
      showStatus("離陸場所をひとつ前の位置に戻しました。");
    } else {
      showStatus("離陸場所の指定を取り消しました。");
    }
  }
}

function handleMapSelection(latlng) {
  if (takeoffMode) {
    placeTakeoffMarker(latlng);
    setTakeoffMode(false);
    showStatus("離陸場所を指定しました。マーカーはドラッグで微調整できます。");
    return true;
  }

  if (flightDrawMode) {
    addFlightDrawPoint(latlng);
    return true;
  }

  return false;
}

/* ---------- イベント登録 ---------- */

elements.addressSearch.addEventListener("click", () => {
  searchAddress();
});

elements.addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchAddress();
  }
});

/* ---------- 現在地追従（GPS） ---------- */

function updateLocationMarker(position) {
  const latlng = [position.coords.latitude, position.coords.longitude];
  const accuracy = position.coords.accuracy;

  if (!locationMarker) {
    locationMarker = L.marker(latlng, {
      icon: currentLocationIcon,
      interactive: false,
      keyboard: false
    }).addTo(map);
  } else {
    locationMarker.setLatLng(latlng);
  }

  if (!locationAccuracyCircle) {
    locationAccuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: "#1f6fb2",
      weight: 1,
      opacity: 0.6,
      fillColor: "#1f6fb2",
      fillOpacity: 0.12,
      interactive: false
    }).addTo(map);
  } else {
    locationAccuracyCircle.setLatLng(latlng);
    locationAccuracyCircle.setRadius(accuracy);
  }

  if (followLocation) {
    map.setView(latlng, Math.max(map.getZoom(), 16), { animate: true });
  }
}

function removeLocationMarker() {
  if (locationMarker) {
    map.removeLayer(locationMarker);
    locationMarker = null;
  }
  if (locationAccuracyCircle) {
    map.removeLayer(locationAccuracyCircle);
    locationAccuracyCircle = null;
  }
}

function stopLocationWatch({ silent = false } = {}) {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  followLocation = false;
  elements.locate.classList.remove("active");
  removeLocationMarker();
  if (!silent) {
    showStatus("現在地の表示を終了しました。");
  }
}

function startLocationWatch() {
  if (!navigator.geolocation) {
    showStatus("このブラウザでは現在地を取得できません。");
    return;
  }

  followLocation = true;
  elements.locate.classList.add("active");
  showStatus("現在地を取得しています。もう一度押すと終了します。");

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      updateLocationMarker(position);
    },
    () => {
      stopLocationWatch({ silent: true });
      showStatus("現在地を取得できませんでした。端末の位置情報設定とブラウザの許可を確認してください。");
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    }
  );
}

elements.locate.addEventListener("click", () => {
  if (locationWatchId !== null) {
    stopLocationWatch();
    return;
  }
  startLocationWatch();
});

elements.takeoff.addEventListener("click", () => {
  polygonDrawer.disable();
  setTakeoffMode(true);
  showStatus("地図をタップして離陸場所を指定してください。");
});

elements.draw.addEventListener("click", () => {
  if (flightDrawMode) {
    finishFlightDraw();
    return;
  }

  setTakeoffMode(false);
  polygonDrawer.disable();
  setFlightDrawMode(true);
  showStatus("地図上を順番にタップして飛行範囲を囲んでください。3点以上指定後、このボタンでもう一度確定します。");
});

elements.undo.addEventListener("click", () => {
  undoLastAction();
});

elements.jpeg.addEventListener("click", async () => {
  await downloadJpeg();
});

elements.pdf.addEventListener("click", async () => {
  await downloadPdf();
});

elements.clear.addEventListener("click", () => {
  const ok = window.confirm("離陸場所、飛行範囲、検索マーカー、入力欄をすべて消去します。よろしいですか？");
  if (!ok) return;

  if (takeoffMarker) {
    map.removeLayer(takeoffMarker);
    takeoffMarker = null;
  }
  if (searchMarker) {
    map.removeLayer(searchMarker);
    searchMarker = null;
  }
  drawnItems.clearLayers();
  removeFlightPreview();
  actionHistory.length = 0;
  elements.inputs.forEach((input) => {
    input.value = "";
  });
  clearFormStorage();
  hideSearchResults();
  elements.addressInput.value = "";
  setTakeoffMode(false);
  setFlightDrawMode(false);
  polygonDrawer.disable();
  refreshCreatedAt();
  showStatus("すべて消去しました。");
});

elements.didLayer.addEventListener("change", () => {
  setTileOverlay(didLayer, elements.didLayer.checked);
});

elements.airportLayer.addEventListener("change", () => {
  setTileOverlay(airportLayer, elements.airportLayer.checked);
  loadAirportRestrictions();
});

elements.droneLawLayer.addEventListener("change", () => {
  setTileOverlay(droneLawLayer, elements.droneLawLayer.checked);
  loadDroneLawRestrictions();
});

elements.newLawLayer.addEventListener("change", () => {
  setTileOverlay(newLawLayer, elements.newLawLayer.checked);
  loadNewLawRestrictions();
});

elements.labels.addEventListener("change", () => {
  setLabelsVisible(elements.labels.checked);
});

elements.inputs.forEach((input) => {
  input.addEventListener("input", saveFormToStorage);
});

map.on("moveend zoomend", () => {
  loadAirportRestrictions();
  loadDroneLawRestrictions();
  loadNewLawRestrictions();
});

let lastHandledTouchAt = 0;

map.on("click", (event) => {
  if (Date.now() - lastHandledTouchAt < 700) return;
  handleMapSelection(event.latlng);
});

map.getContainer().addEventListener("touchend", (event) => {
  if (!takeoffMode && !flightDrawMode) return;
  const touch = event.changedTouches?.[0];
  if (!touch) return;

  event.preventDefault();
  lastHandledTouchAt = Date.now();
  const latlng = map.mouseEventToLatLng(touch);
  handleMapSelection(latlng);
}, { passive: false });

map.on("dragstart zoomstart", () => {
  // 手動操作したら自動追従（画面のパン）だけ止め、現在地マーカーの更新は続ける
  if (followLocation) {
    followLocation = false;
    showStatus("地図を動かしたため追従を停止しました。現在地マーカーの更新は続きます。");
  }

  if (!flightDrawMode || flightDrawPoints.length === 0) return;
  showStatus("描画中です。「戻す」で点を取り消すか、範囲を確定してから地図を移動してください。");
});

map.on(L.Draw.Event.CREATED, (event) => {
  const layer = event.layer;
  bindFlightAreaLabel(layer);
  drawnItems.addLayer(layer);
  actionHistory.push({ type: "flightArea", layer });
  showStatus("飛行範囲を追加しました。編集・削除は地図左上の編集ボタンから行えます。");
});

window.addEventListener("beforeprint", () => {
  if (!isPrinting) {
    isPrinting = true;
    printViewState = {
      center: map.getCenter(),
      zoom: map.getZoom()
    };
    refreshCreatedAt();
    refreshPrintInfo();
    setPdfDocumentTitle();
    setTakeoffMode(false);
    polygonDrawer.disable();
    hideSearchResults();
    document.body.classList.add("print-preparing");
    map.invalidateSize({ pan: false });
    if (takeoffMarker) {
      map.setView(takeoffMarker.getLatLng(), map.getZoom(), { animate: false });
    }
  }
});

window.addEventListener("afterprint", () => {
  restoreScreenLayout();
});

refreshCreatedAt();
restoreFormFromStorage();
setLabelsVisible(labelsVisible);
loadAirportRestrictions();
loadDroneLawRestrictions();
loadNewLawRestrictions();
