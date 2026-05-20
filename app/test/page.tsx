'use client';

import { useState } from 'react';

export default function TestPage() {
  const [count, setCount] = useState(0);
  const [lastEvent, setLastEvent] = useState('none');

  return (
    <div style={{ padding: 40, color: 'white', fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Touch Test</h1>

      <p style={{ marginBottom: 10 }}>Count: {count}</p>
      <p style={{ marginBottom: 20 }}>Last event: {lastEvent}</p>

      <button
        onClick={() => { setCount(c => c + 1); setLastEvent('onClick'); }}
        style={{
          display: 'block',
          width: 200,
          height: 60,
          marginBottom: 10,
          fontSize: 18,
          background: '#333',
          color: 'white',
          border: '2px solid #666',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        onClick
      </button>

      <button
        onTouchEnd={(e) => { e.preventDefault(); setCount(c => c + 1); setLastEvent('onTouchEnd'); }}
        style={{
          display: 'block',
          width: 200,
          height: 60,
          marginBottom: 10,
          fontSize: 18,
          background: '#333',
          color: 'white',
          border: '2px solid #666',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        onTouchEnd
      </button>

      <button
        onPointerUp={() => { setCount(c => c + 1); setLastEvent('onPointerUp'); }}
        style={{
          display: 'block',
          width: 200,
          height: 60,
          marginBottom: 10,
          fontSize: 18,
          background: '#333',
          color: 'white',
          border: '2px solid #666',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        onPointerUp
      </button>
    </div>
  );
}
