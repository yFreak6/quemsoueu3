import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { EYE_HEIGHT, seatAngle } from './layout.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Primeira pessoa: a câmera fica na altura dos olhos do assento do próprio jogador
 * (o host também é um jogador comum). O olhar acompanha suavemente quem tem a vez;
 * arrastar gira o olhar (limitado) e ele volta sozinho quando a vez muda.
 * O campo de visão se adapta à proporção da tela (retrato abre mais).
 */
export default function CameraRig({ seat, n, seatR, turnSeat, shakeAt }) {
  const { camera, gl, size } = useThree();
  const st = useRef({ yaw: null, off: { yaw: 0, pitch: 0 }, drag: null, turnSeat: null, resetting: false });

  const eye = useMemo(() => {
    const a = seatAngle(seat, n);
    const r = seatR - 0.12;
    return new THREE.Vector3(Math.sin(a) * r, EYE_HEIGHT, Math.cos(a) * r);
  }, [seat, n, seatR]);

  // FOV vertical: telas estreitas precisam de mais abertura para a mesa caber na largura
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    camera.fov = aspect < 0.8 ? 84 : aspect < 1.2 ? 72 : 60;
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  useEffect(() => {
    const el = gl.domElement;
    const s = st.current;
    const down = (e) => {
      s.drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!s.drag) return;
      s.off.yaw = clamp(s.off.yaw + (e.clientX - s.drag.x) * 0.004, -1.7, 1.7);
      s.off.pitch = clamp(s.off.pitch + (e.clientY - s.drag.y) * 0.003, -0.4, 0.4);
      s.drag = { x: e.clientX, y: e.clientY };
      s.resetting = false;
    };
    const up = () => {
      s.drag = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', up);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const s = st.current;
    if (s.turnSeat !== turnSeat) {
      s.turnSeat = turnSeat;
      s.resetting = true;
    }
    if (s.resetting && !s.drag) {
      s.off.yaw = THREE.MathUtils.damp(s.off.yaw, 0, 3, dt);
      s.off.pitch = THREE.MathUtils.damp(s.off.pitch, 0, 3, dt);
      if (Math.abs(s.off.yaw) < 0.01 && Math.abs(s.off.pitch) < 0.01) s.resetting = false;
    }

    // alvo: o jogador da vez (se não for eu) ou o centro da mesa
    let tx = 0;
    let tz = 0;
    let ty = 1.0;
    if (turnSeat != null && turnSeat !== seat) {
      const a = seatAngle(turnSeat, n);
      tx = Math.sin(a) * seatR;
      tz = Math.cos(a) * seatR;
      ty = 1.35;
    }
    const dx = tx - eye.x;
    const dz = tz - eye.z;
    const desired = Math.atan2(-dx, -dz);
    if (s.yaw == null) s.yaw = desired;
    const diff = Math.atan2(Math.sin(desired - s.yaw), Math.cos(desired - s.yaw));
    s.yaw += diff * (1 - Math.exp(-3 * dt));
    const pitch = Math.atan2(ty - eye.y, Math.hypot(dx, dz));

    // tremida curta quando o próprio jogador erra um chute
    const since = shakeAt ? (Date.now() - shakeAt) / 1000 : 9;
    const shake = since < 0.5 ? Math.sin(since * 60) * 0.02 * (1 - since / 0.5) : 0;

    camera.position.copy(eye);
    camera.rotation.set(pitch * 0.8 + s.off.pitch + shake, s.yaw + s.off.yaw + shake, 0, 'YXZ');
  });

  return null;
}
