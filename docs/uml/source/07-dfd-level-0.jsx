import React from 'react';

export default function ContextDiagram() {
  // Arrow Line Component
  const Arrow = ({ left, top, color, direction, label, labelPos }) => {
    // Darken the text slightly for the gray arrows to improve readability
    const textColor = color === '#888780' ? '#6B6A62' : color;

    return (
      <div 
        className="absolute" 
        style={{ left: `${left}px`, top: `${top}px`, width: '160px', height: '0px' }}
      >
        <svg className="absolute overflow-visible" style={{ left: 0, top: -5, width: '160px', height: '10px' }}>
          <defs>
            <marker id={`head-${direction}-${color.replace('#', '')}`} viewBox="0 0 10 10" refX={direction === 'right' ? 9 : 1} refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d={direction === 'right' ? "M 0 1 L 10 5 L 0 9 z" : "M 10 1 L 0 5 L 10 9 z"} fill={color} />
            </marker>
          </defs>
          <line 
            x1="0" y1="5" x2="160" y2="5" 
            stroke={color} 
            strokeWidth="1.2" 
            markerEnd={direction === 'right' ? `url(#head-right-${color.replace('#', '')})` : undefined}
            markerStart={direction === 'left' ? `url(#head-left-${color.replace('#', '')})` : undefined}
          />
        </svg>
        <span 
          className={`absolute left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap font-medium`}
          style={{ 
            color: textColor, 
            bottom: labelPos === 'above' ? '6px' : 'auto', 
            top: labelPos === 'below' ? '6px' : 'auto',
            letterSpacing: '-0.1px'
          }}
        >
          {label}
        </span>
      </div>
    );
  };

  // Entity Card Component
  const EntityCard = ({ top, name, subtitle, type }) => {
    const isActor = type === 'actor';
    const accentColor = isActor ? '#7F77DD' : '#888780';
    const tagText = isActor ? 'Actor' : 'Service';

    return (
      <div 
        className="absolute w-[180px] h-[64px] bg-[#fafafa] border border-gray-200 rounded flex flex-col justify-center px-4"
        style={{ 
          top: `${top}px`, 
          borderLeftWidth: '3px', 
          borderLeftColor: accentColor,
          ...(isActor ? { left: '0px' } : { right: '0px' })
        }}
      >
        <div 
          className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-[2px] rounded-[3px] uppercase tracking-wider"
          style={{ color: accentColor, backgroundColor: `${accentColor}15` }}
        >
          {tagText}
        </div>
        <div className="text-[13px] font-bold text-gray-800 pr-12 leading-tight">{name}</div>
        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{subtitle}</div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] font-sans flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-[880px] overflow-x-auto pb-6">
        
        {/* --- DFD Canvas --- */}
        <div className="relative w-[880px] h-[340px] mx-auto shrink-0 mt-2">
          
          {/* Left Column: Actors */}
          <EntityCard top={30} name="Student" subtitle="Mobile browser" type="actor" />
          <EntityCard top={246} name="Instructor" subtitle="Web dashboard" type="actor" />

          {/* Left Arrows (Purple) */}
          {/* Student Pair (Center Y: 62) */}
          <Arrow left={180} top={54} color="#7F77DD" direction="right" label="Scan data" labelPos="above" />
          <Arrow left={180} top={70} color="#7F77DD" direction="left" label="Feedback" labelPos="below" />
          
          {/* Instructor Pair (Center Y: 278) */}
          <Arrow left={180} top={270} color="#7F77DD" direction="right" label="Config" labelPos="above" />
          <Arrow left={180} top={286} color="#7F77DD" direction="left" label="Reports + QR" labelPos="below" />

          {/* Center Column: System */}
          <div 
            className="absolute left-[340px] top-[30px] w-[200px] h-[280px] bg-white rounded-lg border border-[#1D9E75] p-[3px]"
          >
            <div className="w-full h-full rounded bg-[#1D9E75]/[0.02] border border-[#1D9E75]/30 flex flex-col items-center justify-center">
              <h1 className="text-[16px] font-bold text-[#1D9E75] tracking-wide">QR-Guard</h1>
              <p className="text-[11px] text-gray-500 mt-1">Attendance system</p>
            </div>
          </div>

          {/* Right Arrows (Gray) */}
          {/* GPS to System (Center Y: 62) */}
          <Arrow left={540} top={62} color="#888780" direction="left" label="Coordinates" labelPos="above" />
          
          {/* IP to System (Center Y: 170) */}
          <Arrow left={540} top={170} color="#888780" direction="left" label="IP intel" labelPos="above" />
          
          {/* System to Email (Center Y: 278) */}
          <Arrow left={540} top={278} color="#888780" direction="right" label="Notifications" labelPos="above" />

          {/* Right Column: Services */}
          <EntityCard top={30} name="GPS" subtitle="Geolocation API" type="service" />
          <EntityCard top={138} name="IP geolocation" subtitle="ip-api.com" type="service" />
          <EntityCard top={246} name="Email server" subtitle="SMTP / Resend" type="service" />

        </div>

        {/* --- Legend --- */}
        <div className="mt-12 pt-8 border-t border-gray-200/60">
          <h2 className="text-[14px] font-semibold text-gray-800 mb-5 tracking-tight">Data flow legend</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#7F77DD]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">Scan data</div>
              <div className="text-[11px] text-gray-500 leading-snug">Credentials, QR payload, GPS + accuracy, device ID, IP</div>
            </div>

            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#7F77DD]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">Feedback</div>
              <div className="text-[11px] text-gray-500 leading-snug">Confirmation / rejection with reason, dashboard, warnings</div>
            </div>

            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#7F77DD]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">Config</div>
              <div className="text-[11px] text-gray-500 leading-snug">Course setup, geofence, thresholds, session control, overrides</div>
            </div>

            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#7F77DD]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">Reports + QR</div>
              <div className="text-[11px] text-gray-500 leading-snug">Dynamic QR (WebSocket), live counter, reports, CSV, flags</div>
            </div>

            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#888780]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">Coordinates</div>
              <div className="text-[11px] text-gray-500 leading-snug">Latitude, longitude, accuracy (m) via Geolocation API</div>
            </div>

            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#888780]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">IP intel</div>
              <div className="text-[11px] text-gray-500 leading-snug">Country, ISP, VPN/proxy flag</div>
            </div>

            <div className="bg-[#fafafa] p-3.5 rounded border border-gray-100 border-l-[3px] border-l-[#888780]">
              <div className="font-bold text-[12px] text-gray-800 mb-0.5">Notifications</div>
              <div className="text-[11px] text-gray-500 leading-snug">Verification, warning, and alert emails</div>
            </div>

          </div>
        </div>
        
      </div>
    </div>
  );
}
