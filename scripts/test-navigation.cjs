const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TabRouter, TabActions } = require('expo-router/build/react-navigation/routers/TabRouter');

function load(file, mocks) {
  const filename = path.resolve(file), compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => mocks[name] ?? originalRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return compiled.exports;
}
const element = (type, props) => ({ type, props });
const runtime = { jsx: element, jsxs: element };
const components = names => Object.fromEntries(names.map(name => [name, name]));
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children), ...nodes(node.props?.ListHeaderComponent)];
}

test('tab navigation keeps independent searches, filters and views while sharing document actions', () => {
  const icons = new Proxy({}, { get: (_target, name) => name });
  const { applicationTabs } = load('src/lib/app-navigation.ts', { 'lucide-react-native': icons });
  const Tabs = Object.assign(function Tabs() {}, { Screen: 'TabScreen' });
  const { default: TabsLayout } = load('src/app/(tabs)/_layout.tsx', {
    'react/jsx-runtime': runtime, 'expo-router': { Tabs },
    'react-native': { useWindowDimensions: () => ({ width: 800 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    '@/components/application-shell': { ApplicationShell: 'ApplicationShell' },
    '@/components/document-actions': { DocumentActionsProvider: 'DocumentActionsProvider' },
    '@/components/pdf-styles': { green: '#245E4C' }, '@/lib/app-navigation': { applicationTabs },
  });
  const layout = TabsLayout(), tabs = nodes(layout).find(node => node.type === Tabs);
  assert.equal(layout.type, 'DocumentActionsProvider', 'Operations belong to the persistent layout');
  assert.equal(nodes(layout).find(node => node.type === 'ApplicationShell').props.children, tabs, 'The shared frame wraps the navigator');
  assert.equal(tabs.props.screenOptions.animation, 'none');
  assert.equal(tabs.props.screenOptions.lazy, true);
  assert.equal(tabs.props.screenOptions.freezeOnBlur, true);
  const screens = nodes(tabs).filter(node => node.type === 'TabScreen');
  assert.deepEqual(screens.map(screen => screen.props.name), ['index', 'files', 'tools', 'favorites']);
  const names = screens.map(screen => screen.props.name);
  const options = { routeNames: names, routeParamList: Object.fromEntries(names.map(name => [name, undefined])), routeGetIdList: {} };
  const navigator = TabRouter({ initialRouteName: tabs.props.initialRouteName, backBehavior: tabs.props.backBehavior });
  let state = navigator.getInitialState(options);
  const originalKeys = state.routes.map(route => route.key), instances = new Map(), actions = [];
  const documents = [
    { id: 'contract', name: 'Contrato', updated: 1, favorite: false, kind: 'pdf' },
    { id: 'scan', name: 'Scan factura', updated: 2, favorite: true, kind: 'scan' },
    { id: 'other', name: 'Otro documento', updated: 3, favorite: true, kind: 'pdf' },
  ];
  const shared = { documents, loaded: true, busy: false, action: id => actions.push(id) };
  function visit(name) {
    state = navigator.getStateForAction(state, TabActions.jumpTo(name), options);
    const route = state.routes[state.index];
    assert.equal(route.name, name);
    assert.deepEqual(state.routes.map(item => item.key), originalKeys, 'Switching tabs retains the mounted route identities');
    if (!instances.has(route.key)) {
      const slots = []; let cursor = 0;
      const hooks = {
        useMemo: factory => factory(),
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
      };
      const { DocumentWorkspace } = load('src/components/document-workspace.tsx', {
        react: hooks, 'react/jsx-runtime': runtime, 'expo-router': { router: {} },
        'react-native': { ...components(['ActivityIndicator', 'FlatList', 'Pressable', 'Text', 'TextInput', 'View']), useWindowDimensions: () => ({ width: 800 }) },
        'expo-linear-gradient': { LinearGradient: 'LinearGradient' }, 'lucide-react-native': icons,
        '@/components/document-actions': { useDocumentActions: () => shared },
        '@/components/document-card': { DocumentCard: 'DocumentCard' },
        '@/components/pdf-ui': components(['Button', 'HeroIllustration', 'IconButton']),
        '@/components/pdf-styles': { green: '#245E4C', styles: new Proxy({}, { get: () => ({}) }) },
      });
      const { default: Screen } = load(`src/app/(tabs)/${name}.tsx`, { 'react/jsx-runtime': runtime, '@/components/document-workspace': { DocumentWorkspace } });
      instances.set(route.key, () => { cursor = 0; return DocumentWorkspace(Screen().props); });
    }
    return instances.get(route.key)();
  }
  const input = tree => nodes(tree).find(node => node.type === 'TextInput').props;
  const viewButton = (tree, label) => nodes(tree).find(node => node.type === 'IconButton' && node.props.label === label).props;
  let files = visit('files');
  assert.equal(files.props.numColumns, 1);
  input(files).onChangeText('SCAN');
  viewButton(files, 'Vista de cuadrícula').onPress();
  const filter = nodes(visit('files')).find(node => node.type === 'Pressable' && nodes(node).some(child => child.props?.children === 'Digitalizados'));
  filter.props.onPress();
  files = visit('files');
  assert.deepEqual(files.props.data.map(doc => doc.id), ['scan']);
  assert.equal(files.props.numColumns, 3);
  let favorites = visit('favorites');
  assert.equal(favorites.props.numColumns, 1, 'Favorites starts in list view independently of the library');
  assert.deepEqual(favorites.props.data.map(doc => doc.id), ['other', 'scan']);
  input(favorites).onChangeText('Contrato');
  assert.equal(visit('favorites').props.data.length, 0, 'Searching favorites never includes other library records');
  input(visit('favorites')).onChangeText('factura');
  viewButton(visit('favorites'), 'Vista de cuadrícula').onPress();
  const tools = visit('tools');
  const merge = nodes(tools).find(node => node.type === 'Pressable' && nodes(node).some(child => child.props?.children === 'Unir documentos'));
  merge.props.onPress(); assert.deepEqual(actions, ['merge']);
  files = visit('files');
  assert.equal(input(files).value, 'SCAN'); assert.equal(files.props.numColumns, 3);
  assert.deepEqual(files.props.data.map(doc => doc.id), ['scan']);
  favorites = visit('favorites');
  assert.equal(input(favorites).value, 'factura'); assert.equal(favorites.props.numColumns, 3);
  assert.deepEqual(favorites.props.data.map(doc => doc.id), ['scan']);
  const back = navigator.getStateForAction(state, { type: 'GO_BACK' }, options);
  assert.equal(back.routes[back.index].name, 'files', 'Back returns to the previous tab without replacing the layout');
  const active = screens[state.index].props.options.tabBarIcon({ color: tabs.props.screenOptions.tabBarActiveTintColor, focused: true });
  const inactive = screens[0].props.options.tabBarIcon({ color: tabs.props.screenOptions.tabBarInactiveTintColor, focused: false });
  assert.notEqual(active.props.color, inactive.props.color);
});
