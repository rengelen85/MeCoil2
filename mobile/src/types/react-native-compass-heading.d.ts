declare module 'react-native-compass-heading' {
  interface CompassData {
    heading: number;
    accuracy: number;
  }
  const CompassHeading: {
    start(degreeUpdateRate: number, callback: (data: CompassData) => void): void;
    stop(): void;
  };
  export default CompassHeading;
}
