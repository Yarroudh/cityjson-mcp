import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from '/vendor/OrbitControls.js';

const TYPE_COLORS = {
  Building: 0x7497df, BuildingPart: 0x7497df, BuildingInstallation: 0x7497df,
  Bridge: 0x999999, BridgePart: 0x999999, BridgeInstallation: 0x999999,
  CityFurniture: 0xcc6655, GenericCityObject: 0xcc6655, LandUse: 0xd8c76b,
  PlantCover: 0x52a65a, SolitaryVegetationObject: 0x52a65a, Railway: 0x555555,
  Road: 0x888888, TINRelief: 0xc9a06a, TransportSquare: 0x999999,
  Tunnel: 0x9b8aa5, TunnelPart: 0x9b8aa5, WaterBody: 0x4da6ff
};

// Matches the conventional semantic palette used by CityJSON Ninja.
const SEMANTIC_COLORS = {
  GroundSurface: 0x999999,
  WallSurface: 0xffffff,
  RoofSurface: 0xff0000,
  ClosureSurface: 0xb8a58d,
  OuterCeilingSurface: 0xd7c8a4,
  OuterFloorSurface: 0x9d8267,
  Window: 0x0059ff,
  Door: 0x640000,
  TrafficArea: 0x6e6e6e,
  AuxiliaryTrafficArea: 0x2c8200,
  WaterSurface: 0x4da6ff,
  WaterGroundSurface: 0x397eb5,
  WaterClosureSurface: 0x72bce8
};

function transformedVertices(model) {
  const scale = model.transform?.scale || [1, 1, 1];
  const translate = model.transform?.translate || [0, 0, 0];
  const vertices = (model.vertices || []).map(vertex => new THREE.Vector3(
    vertex[0] * scale[0] + translate[0],
    vertex[1] * scale[1] + translate[1],
    vertex[2] * scale[2] + translate[2]
  ));
  // Keep projected/UTM coordinates close to the origin before converting to
  // Float32 GPU buffers; this avoids visible jitter in large-coordinate models.
  const origin = vertices[0]?.clone() || new THREE.Vector3();
  for (const vertex of vertices) vertex.sub(origin);
  return vertices;
}

function geometrySurfaces(geometry) {
  const boundaries = geometry?.boundaries || [];
  const values = geometry?.semantics?.values;
  if (['MultiSurface', 'CompositeSurface'].includes(geometry.type)) {
    return boundaries.map((surface, surfaceIndex) => ({ surface, semanticIndex: values?.[surfaceIndex], boundaryPath: [surfaceIndex] }));
  }
  if (geometry.type === 'Solid') {
    return boundaries.flatMap((shell, shellIndex) => shell.map((surface, surfaceIndex) => ({
      surface, semanticIndex: values?.[shellIndex]?.[surfaceIndex], boundaryPath: [shellIndex, surfaceIndex]
    })));
  }
  if (['MultiSolid', 'CompositeSolid'].includes(geometry.type)) {
    return boundaries.flatMap((solid, solidIndex) => solid.flatMap((shell, shellIndex) => shell.map((surface, surfaceIndex) => ({
      surface, semanticIndex: values?.[solidIndex]?.[shellIndex]?.[surfaceIndex], boundaryPath: [solidIndex, shellIndex, surfaceIndex]
    }))));
  }
  return [];
}

function projectRing(points) {
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }
  const axis = ['x', 'y', 'z'].sort((a, b) => Math.abs(normal[b]) - Math.abs(normal[a]))[0];
  return points.map(point => axis === 'x'
    ? new THREE.Vector2(point.y, point.z)
    : axis === 'y' ? new THREE.Vector2(point.x, point.z) : new THREE.Vector2(point.x, point.y));
}

function appendSurface(surface, vertices, positions) {
  if (!Array.isArray(surface) || !surface.length) return 0;
  const rings = surface.map(ring => ring.map(index => vertices[index]).filter(Boolean)).filter(ring => ring.length >= 3);
  if (!rings.length) return 0;
  const flatPoints = rings.flat();
  const contour = projectRing(rings[0]);
  const holes = rings.slice(1).map(projectRing);
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const face of faces) {
    for (const index of face) positions.push(...flatPoints[index].toArray());
  }
  return faces.length;
}

function objectMesh(id, object, vertices) {
  const positions = [];
  const semanticColors = [];
  const triangleMetadata = [];
  let triangleCount = 0;
  for (const [geometryIndex, geometry] of (object.geometry || []).entries()) {
    for (const record of geometrySurfaces(geometry)) {
      const added = appendSurface(record.surface, vertices, positions);
      const semantic = Number.isInteger(record.semanticIndex) ? geometry.semantics?.surfaces?.[record.semanticIndex] : null;
      const surfaceColor = new THREE.Color(SEMANTIC_COLORS[semantic?.type] ?? TYPE_COLORS[object.type] ?? 0xb98b62);
      for (let index = 0; index < added * 3; index++) semanticColors.push(surfaceColor.r, surfaceColor.g, surfaceColor.b);
      for (let index = 0; index < added; index++) triangleMetadata.push({
        geometryIndex,
        boundaryPath: record.boundaryPath,
        semanticIndex: record.semanticIndex,
        semantic: semantic || null
      });
      triangleCount += added;
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(semanticColors, 3));
  geometry.computeVertexNormals();
  const color = TYPE_COLORS[object.type] ?? 0xb98b62;
  const material = new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .02, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { id, object, triangleCount, triangleMetadata };
  return mesh;
}

export class CityJsonViewer {
  constructor(container, { onStats, onError, onSelect } = {}) {
    this.container = container;
    this.onStats = onStats;
    this.onError = onError;
    this.onSelect = onSelect;
    this.selectionMode = 'object';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111319);
    this.camera = new THREE.PerspectiveCamera(52, 1, .01, 100000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio <= 1.5, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the current CityJSON model');
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .08;
    this.controls.addEventListener('change', () => this.render());
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.scene.add(new THREE.HemisphereLight(0xe8efff, 0x37312b, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(-1, -2, 3);
    this.scene.add(light);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerStart = null;
    this.selectedMesh = null;
    this.selectionMesh = null;
    this.renderer.domElement.addEventListener('pointerdown', event => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', event => {
      if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 4) return;
      this.pick(event);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  animate() {
    if (this.controls.update()) this.render();
    this.frame = requestAnimationFrame(this.animate);
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  clear() {
    this.clearSelection();
    for (const child of [...this.modelGroup.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      this.modelGroup.remove(child);
    }
  }

  load(model) {
    this.clear();
    const vertices = transformedVertices(model);
    let triangles = 0;
    let renderedObjects = 0;
    for (const [id, object] of Object.entries(model.CityObjects || {})) {
      const mesh = objectMesh(id, object, vertices);
      if (!mesh) continue;
      mesh.name = id;
      this.modelGroup.add(mesh);
      mesh.material.vertexColors = true;
      triangles += mesh.userData.triangleCount;
      renderedObjects++;
    }
    if (!renderedObjects) throw new Error('No renderable surface or solid geometry was found in this dataset.');
    this.fit();
    this.onStats?.({ renderedObjects, triangles, vertices: vertices.length });
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * .5, .01);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov * .5)) * 1.15;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(distance * .7, -distance, distance * .75));
    this.camera.near = Math.max(distance / 1000, .001);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = distance * 12;
    this.controls.update();
    this.render();
  }

  setSelectionMode(mode) {
    this.selectionMode = mode === 'surface' ? 'surface' : 'object';
    this.clearSelection();
    this.render();
  }

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersection = this.raycaster.intersectObjects(this.modelGroup.children, false)[0];
    if (!intersection) {
      this.clearSelection();
      return;
    }
    this.selectIntersection(intersection);
  }

  selectIntersection(intersection) {
    this.clearSelection(false);
    const mesh = intersection.object;
    const metadata = mesh.userData.triangleMetadata?.[intersection.faceIndex] || {};
    this.selectedMesh = mesh;
    const object = mesh.userData.object;
    if (this.selectionMode === 'object') {
      const geometry = mesh.geometry.clone();
      const material = this.highlightMaterial();
      this.selectionMesh = new THREE.Mesh(geometry, material);
      this.selectionMesh.renderOrder = 10;
      this.scene.add(this.selectionMesh);
      this.onSelect?.({ id: mesh.userData.id, object });
    } else {
      const source = mesh.geometry.getAttribute('position');
      const sameBoundary = candidate => candidate.geometryIndex === metadata.geometryIndex
        && JSON.stringify(candidate.boundaryPath) === JSON.stringify(metadata.boundaryPath);
      const triangles = [];
      mesh.userData.triangleMetadata.forEach((candidate, triangleIndex) => {
        if (!sameBoundary(candidate)) return;
        for (let offset = 0; offset < 3; offset++) {
          const index = triangleIndex * 3 + offset;
          triangles.push(source.getX(index), source.getY(index), source.getZ(index));
        }
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
      const material = this.highlightMaterial();
      this.selectionMesh = new THREE.Mesh(geometry, material);
      this.selectionMesh.renderOrder = 10;
      this.scene.add(this.selectionMesh);
      this.onSelect?.({
        id: mesh.userData.id,
        object,
        geometry: object.geometry?.[metadata.geometryIndex],
        geometryIndex: metadata.geometryIndex,
        boundaryPath: metadata.boundaryPath,
        semantic: metadata.semantic,
        semanticIndex: metadata.semanticIndex
      });
    }
    this.render();
  }

  clearSelection(notify = true) {
    this.selectedMesh = null;
    if (this.selectionMesh) {
      this.scene.remove(this.selectionMesh);
      this.selectionMesh.geometry.dispose();
      this.selectionMesh.material.dispose();
      this.selectionMesh = null;
    }
    if (notify) this.onSelect?.(null);
    this.render();
  }

  highlightMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffb45f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: .88,
      depthTest: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
