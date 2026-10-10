// The planner page's entry point: sets every module up in a fixed order,
// then loads the styles and restores the autosaved plan.
//
// Importing a module only defines it (plus building the static DOM, in
// layout.js); everything that touches other modules happens in its init
// function, called here, so startup order is explicit rather than implied
// by the import graph.

import { initNavBar } from "../lib/nav.js";
import * as backgroundStore from "./background-store.js";
import * as buildingActions from "./building-actions.js";
import * as buildings from "./buildings.js";
import * as catalog from "./catalog.js";
import * as cellGeometry from "./cell-geometry.js";
import * as config from "./config.js";
import * as displaySettings from "./display-settings.js";
import * as gridPointer from "./grid-pointer.js";
import * as gridView from "./grid-view.js";
import * as history from "./history.js";
import * as keyboard from "./keyboard.js";
import * as layout from "./layout.js";
import * as namedPlans from "./named-plans.js";
import * as panes from "./panes.js";
import * as pathTool from "./path-tool.js";
import * as paths from "./paths.js";
import * as persistence from "./persistence.js";
import * as planCheck from "./plan-check.js";
import * as planState from "./plan-state.js";
import * as preview from "./preview.js";
import * as roadRuns from "./road-runs.js";
import * as roadTypes from "./road-types.js";
import * as runKits from "./run-kits.js";
import * as runLayout from "./run-layout.js";
import * as runNetwork from "./run-network.js";
import * as rooftop from "./rooftop.js";
import * as selection from "./selection.js";
import * as sidebarHints from "./sidebar-hints.js";
import * as tray from "./tray.js";
import * as worldBackground from "./world-background.js";

// Read-only access to the planner's state for the e2e tests (and the
// browser console): __planner.<any exported name> is a live getter, and
// __planner.ready turns true once startup has finished.
function exposeForTests(modules) {
	const handle = { ready: false };
	for (const [moduleName, namespace] of Object.entries(modules)) {
		for (const name of Object.keys(namespace)) {
			if (Object.hasOwn(handle, name)) {
				console.error(`__planner: "${name}" is exported by more than one module (${moduleName})`);
				continue;
			}
			Object.defineProperty(handle, name, { get: () => namespace[name], enumerable: true });
		}
	}
	window.__planner = handle;
	return handle;
}

const testHandle = exposeForTests({
	backgroundStore,
	buildingActions,
	buildings,
	catalog,
	cellGeometry,
	config,
	displaySettings,
	gridPointer,
	gridView,
	history,
	keyboard,
	layout,
	namedPlans,
	paths,
	pathTool,
	persistence,
	planCheck,
	planState,
	preview,
	roadRuns,
	roadTypes,
	runKits,
	runLayout,
	runNetwork,
	rooftop,
	selection,
	tray,
	worldBackground,
});

initNavBar("planner", keyboard.SHORTCUT_GROUPS);
panes.initPanes();
gridView.initGridView();
displaySettings.initDisplaySettings();
sidebarHints.initSidebarHints();
buildings.initBuildings();
paths.initPaths();
pathTool.initPathTool();
tray.initTray();
preview.initPreview();
buildingActions.initBuildingActions();
gridPointer.initGridPointer();
keyboard.initKeyboard();
worldBackground.initWorldBackground();
planCheck.initPlanCheck();
history.initHistory();
persistence.initPersistence();
namedPlans.initNamedPlans();
rooftop.loadRooftopManifest(); // not awaited: renders appear when it arrives

await catalog.loadAllStyles();
await tray.applyStyle(config.STYLE_FILES[0].file);
await persistence.restoreAutosave();
// After the restore, which can resize the grid the scroll position needs.
gridView.restoreGridView();
testHandle.ready = true;
