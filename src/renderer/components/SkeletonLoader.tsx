export function SkeletonLoader() {
  return (
    <div className="skeleton-container">
      <div className="skeleton-preset-bar">
        <div className="skeleton-circle" />
        <div className="skeleton-circle" />
        <div className="skeleton-circle" />
        <div className="skeleton-mode" />
      </div>
      <div className="skeleton-card" />
      <div className="skeleton-card" />
      <div className="skeleton-card" />
      <div className="skeleton-card" />
      <div className="skeleton-toolbar">
        <div className="skeleton-btn" />
        <div className="skeleton-btn" />
        <div className="skeleton-btn" />
        <div className="skeleton-btn" />
        <div className="skeleton-btn" />
      </div>
    </div>
  );
}
