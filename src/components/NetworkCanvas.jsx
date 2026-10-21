import { useEffect, useRef } from 'react';

const COLORS = ['22, 172, 216', '248, 166, 39', '80, 140, 220'];

// Slowly drifting network of nodes, sized to its container (it follows the
// container as it resizes, e.g. the navigation panel expanding). Still for
// reduced motion. `area` is the space per node in px², `reach` the link distance.
export default function NetworkCanvas({ className, area = 16000, maxNodes = 70, reach = 130 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = [];
    let frame = 0;

    const addNode = (width, height) => {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        color: COLORS[nodes.length % COLORS.length],
      });
    };

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Keep existing nodes so a resize doesn't make the field jump.
      const count = Math.round(Math.min(maxNodes, (width * height) / area));
      while (nodes.length < count) addNode(width, height);
      nodes.length = count;
    }

    function draw() {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      context.clearRect(0, 0, width, height);
      if (!still) {
        for (const node of nodes) {
          node.x += node.vx;
          node.y += node.vy;
          if ((node.x < 0 && node.vx < 0) || (node.x > width && node.vx > 0)) node.vx *= -1;
          if ((node.y < 0 && node.vy < 0) || (node.y > height && node.vy > 0)) node.vy *= -1;
        }
      }
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (distance < reach) {
            context.strokeStyle = `rgba(${nodes[i].color}, ${0.16 * (1 - distance / reach)})`;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(nodes[i].x, nodes[i].y);
            context.lineTo(nodes[j].x, nodes[j].y);
            context.stroke();
          }
        }
      }
      for (const node of nodes) {
        context.fillStyle = `rgba(${node.color}, 0.75)`;
        context.beginPath();
        context.arc(node.x, node.y, 1.6, 0, Math.PI * 2);
        context.fill();
      }
      if (!still) frame = requestAnimationFrame(draw);
    }

    resize();
    draw();
    const observer = new ResizeObserver(() => {
      resize();
      if (still) draw();
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [area, maxNodes, reach]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}
