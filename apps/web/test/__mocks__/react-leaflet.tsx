import type { ReactNode } from 'react';
export const MapContainer = ({ children }: { children?: ReactNode }) => <div data-testid="mock-mapcontainer">{children}</div>;
export const TileLayer = () => null;
export const Marker = () => null;
export const Popup = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
export const useMap = () => ({ setView: () => {}, flyTo: () => {} });
