(function buildCharts(global) {
  function drawLineChart(canvas, points, options) {
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const padding = 16;
    context.clearRect(0, 0, width, height);

    context.fillStyle = "#081412";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;

    for (let index = 0; index < 4; index += 1) {
      const y = padding + ((height - padding * 2) / 3) * index;
      context.beginPath();
      context.moveTo(padding, y);
      context.lineTo(width - padding, y);
      context.stroke();
    }

    if (!points.length) {
      return;
    }

    const values = points.map((entry) => entry.value);
    const min = Math.min(...values, options.min);
    const max = Math.max(...values, options.max);
    const range = max - min || 1;

    context.beginPath();
    points.forEach((entry, index) => {
      const x = padding + ((width - padding * 2) / (points.length - 1 || 1)) * index;
      const normalized = (entry.value - min) / range;
      const y = height - padding - normalized * (height - padding * 2);
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });

    context.strokeStyle = options.color;
    context.lineWidth = 2.6;
    context.stroke();

    const last = points[points.length - 1];
    const x = width - padding;
    const normalized = (last.value - min) / range;
    const y = height - padding - normalized * (height - padding * 2);

    context.fillStyle = options.color;
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
  }

  function drawCamera(canvas, payload) {
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const time = payload.time / 1000;

    context.fillStyle = "#07100f";
    context.fillRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#19332d");
    gradient.addColorStop(1, "#081412");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "rgba(255,255,255,0.05)";
    for (let index = 0; index < 20; index += 1) {
      context.fillRect(index * 40, 0, 1, height);
      context.fillRect(0, index * 28, width, 1);
    }

    const trayY = height - 82;
    context.fillStyle = "#243731";
    context.fillRect(40, trayY, width - 80, 26);
    context.fillRect(54, trayY - 18, width - 108, 24);

    for (let index = 0; index < 8; index += 1) {
      const x = 78 + index * 68;
      const sway = Math.sin(time * 1.3 + index * 0.6) * 6;
      const growth = 42 + Math.sin(time + index) * 8;

      context.strokeStyle = "#9fe57b";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x, trayY - 2);
      context.quadraticCurveTo(x + sway, trayY - growth * 0.5, x + sway * 1.4, trayY - growth);
      context.stroke();

      context.fillStyle = "#8cd669";
      context.beginPath();
      context.ellipse(x + sway * 1.2, trayY - growth + 4, 12, 7, 0.5, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.ellipse(x + sway * 0.6 - 10, trayY - growth * 0.72, 11, 6, -0.6, 0, Math.PI * 2);
      context.fill();
    }

    const bubbleOffset = (time * 24) % 120;
    context.fillStyle = "rgba(143, 224, 255, 0.7)";
    for (let index = 0; index < 14; index += 1) {
      context.beginPath();
      context.arc(72 + index * 36, trayY + 10 - ((bubbleOffset + index * 18) % 110), 2 + (index % 3), 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = "rgba(255,255,255,0.08)";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(255,255,255,0.16)";
    context.lineWidth = 1.5;
    context.strokeRect(12, 12, width - 24, height - 24);
  }

  global.HydroVisionCharts = {
    drawLineChart,
    drawCamera
  };
})(window);
