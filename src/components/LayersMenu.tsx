import { useState } from 'react';
import type { Layers } from './MapView';
import { iconUrl } from '../lib/icons';
import { Icon } from './Icon';

interface Props {
  layers: Layers;
  onChange: (l: Layers) => void;
  hasTraffic: boolean;
}

const ROWS: { key: keyof Layers; label: string; icons: string[] }[] = [
  { key: 'camera', label: 'Cameras', icons: ['rw-camera'] },
  { key: 'bump', label: 'Speed bumps', icons: ['rw-bump'] },
  { key: 'pothole', label: 'Potholes', icons: ['rw-pothole'] },
  { key: 'sign', label: 'Signs & lights', icons: ['rw-stop', 'rw-signals', 'rw-sign'] },
];

export function LayersMenu({ layers, onChange, hasTraffic }: Props) {
  const [open, setOpen] = useState(false);
  const toggle = (k: keyof Layers) => onChange({ ...layers, [k]: !layers[k] });

  return (
    <div className="layers">
      <button className={`fab ${open ? 'fab-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Map layers" aria-expanded={open}>
        <Icon name="layers" />
      </button>
      {open && (
        <div className="popover layers-menu">
          <div className="popover-head">
            <h3>Map details</h3>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="layer-grid">
            {ROWS.map((r) => (
              <button key={r.key} className={`layer-tile ${layers[r.key] ? 'layer-on' : ''}`} onClick={() => toggle(r.key)} aria-pressed={layers[r.key]}>
                <span className="layer-icons">
                  {r.icons.map((i) => (
                    <img key={i} src={iconUrl(i)} alt="" />
                  ))}
                </span>
                {r.label}
              </button>
            ))}
            <button
              className={`layer-tile ${layers.traffic ? 'layer-on' : ''}`}
              disabled={!hasTraffic}
              onClick={() => toggle('traffic')}
              aria-pressed={layers.traffic}
            >
              <span className="layer-icons"><span className="traffic-swatch" /></span>
              Traffic
            </button>
          </div>
          <div className="legend">
            <h4>What you see on the map</h4>
            <div className="legend-row"><span className="lg-route" /> Your route: amber or red where traffic is slow</div>
            <div className="legend-row"><span className="lg-jam">+2 min</span> Extra time a jam adds to your trip</div>
            <div className="legend-row"><span className="lg-traffic" /> Live traffic: green flowing, amber slow, red jammed</div>
            <div className="legend-row"><span className="lg-camroad" /> Road where speed cameras are reported</div>
            <div className="legend-row"><span className="lg-camzone" /> Area where speed cameras are reported</div>
            <div className="legend-row"><span className="lg-est">est</span> Speed limit is Ghana's default for the road, not a recorded sign</div>
          </div>
          <p className="popover-foot">
            {hasTraffic ? '' : 'Live traffic needs a Mapbox token. '}A purple ring marks hazards you reported. Tap any icon, dashed road or circle for details.
          </p>
        </div>
      )}
    </div>
  );
}
