import { h } from '../util.js';

// A Leaflet map on OpenStreetMap tiles, shared by the routing screens. In the dark theme the
// tiles are darkened in CSS; without a network the markers and routes still show.

/* global L */
export function createMap(el) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, zoomSnap: 0.25 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  const routes = L.layerGroup().addTo(map);
  const sites = L.layerGroup().addTo(map);
  let bounds = '';
  return {
    map,
    routes,
    sites,
    /** Frames the given points, once per distinct set of points. */
    fit(points) {
      const key = JSON.stringify(points);
      if (key === bounds || points.length === 0) return;
      bounds = key;
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
    },
    resize() { map.invalidateSize(); },
    remove() { map.remove(); },
  };
}

/** A round (or square, or diamond) marker in the colour of its route. */
export function siteMarker(latlng, { cls = '', colour = null, size = 14, label = '' }) {
  const icon = L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: h('div', { class: `site ${cls}`, style: { width: `${size}px`, height: `${size}px`, ...(colour ? { '--c': colour } : {}) } }).outerHTML,
  });
  const marker = L.marker(latlng, { icon, keyboard: false });
  // The label carries names from the plan: it is given as an element, so that it is shown as text and never read as HTML.
  if (label) marker.bindTooltip(h('span', {}, label), { direction: 'top', offset: [0, -size / 2] });
  return marker;
}

export function routeLine(points, colour, { weight = 3, dashed = false } = {}) {
  return L.polyline(points, { color: colour, weight, opacity: 0.92, dashArray: dashed ? '2 7' : null, lineJoin: 'round' });
}

/** Resolves a CSS custom property colour (var(--c3)) to something Leaflet's SVG can use. */
export function resolve(colour) {
  const match = /var\((--[\w-]+)\)/.exec(colour);
  return match ? getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() : colour;
}
