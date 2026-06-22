import React from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { circleFeature, polygonFeature, lineFeature } from '../lib/geo.js';

type Pt = { lat: number; lng: number };

/** A circle with a radius in metres, drawn as a filled + outlined polygon. */
export function MeterCircle({
  id,
  lat,
  lng,
  radiusM,
  color,
  fillOpacity = 0.18,
  dashed = false,
}: {
  id: string;
  lat: number;
  lng: number;
  radiusM: number;
  color: string;
  fillOpacity?: number;
  dashed?: boolean;
}) {
  return (
    <GeoJSONSource id={id} data={circleFeature(lat, lng, radiusM)}>
      <Layer id={`${id}-fill`} type="fill" style={{ fillColor: color, fillOpacity }} />
      <Layer
        id={`${id}-line`}
        type="line"
        style={{ lineColor: color, lineWidth: 2, ...(dashed ? { lineDasharray: [2, 2] } : {}) }}
      />
    </GeoJSONSource>
  );
}

/** A filled + outlined polygon from an ordered list of points. */
export function ShapePolygon({
  id,
  points,
  color,
  fillOpacity = 0.12,
}: {
  id: string;
  points: Pt[];
  color: string;
  fillOpacity?: number;
}) {
  return (
    <GeoJSONSource id={id} data={polygonFeature(points)}>
      <Layer id={`${id}-fill`} type="fill" style={{ fillColor: color, fillOpacity }} />
      <Layer id={`${id}-line`} type="line" style={{ lineColor: color, lineWidth: 2 }} />
    </GeoJSONSource>
  );
}

/** A polyline through an ordered list of points. */
export function ShapeLine({
  id,
  points,
  color,
  dashed = true,
}: {
  id: string;
  points: Pt[];
  color: string;
  dashed?: boolean;
}) {
  return (
    <GeoJSONSource id={id} data={lineFeature(points)}>
      <Layer
        id={`${id}-line`}
        type="line"
        style={{ lineColor: color, lineWidth: 2, ...(dashed ? { lineDasharray: [2, 2] } : {}) }}
      />
    </GeoJSONSource>
  );
}
