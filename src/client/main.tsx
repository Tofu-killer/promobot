import React from 'react';
import ReactDOM from 'react-dom/client';

function BootstrapApp() {
  return <div>PromoBot bootstrap</div>;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BootstrapApp />
  </React.StrictMode>
);
