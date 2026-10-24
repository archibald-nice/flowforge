import { ReactFlow, Background, MiniMap, type Edge, type NodeChange, type Connection, type useReactFlow } from '@xyflow/react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { breakRun, type Command, type History } from '../domain/history.ts';
import { zoomAt } from '../domain/viewport.ts';
import { isMediaNode, type Project } from '../domain/project.ts';
import { nodeTypes, type CardNode } from './NodeCard.tsx';

export interface CanvasStageProps {
  ready: boolean;
  nodes: CardNode[];
  edges: Edge[];
  minimap: boolean;
  space: boolean;
  project: Project;
  projectRef: RefObject<Project>;
  change: (next: Project, command?: Command) => void;
  flow: ReturnType<typeof useReactFlow<CardNode>>;
  onNodesChange: (changes: NodeChange<CardNode>[]) => void;
  connect: (connection: Connection) => void;
  history: History;
  setSelectedId: Dispatch<SetStateAction<string>>;
  setPrepared: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setSelectionCount: Dispatch<SetStateAction<number>>;
}

/** The React Flow canvas: reference edges between cards, anchored zoom, space
 * panning, minimap and viewport tools. */
export function CanvasStage({ ready, nodes, edges, minimap, space, project, projectRef, change, flow,
  onNodesChange, connect, history, setSelectedId, setPrepared, setNotice, setSelectionCount }: CanvasStageProps) {
  return <section className="canvas-stage" aria-label="Creative context canvas" tabIndex={0} onWheelCapture={event => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
      const next = zoomAt(flow.getViewport(), { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-event.deltaY * 0.005));
      void flow.setViewport(next);
    }
  }}>
    {ready && <ReactFlow<CardNode> nodes={nodes} edges={edges}
      nodeTypes={nodeTypes} onNodesChange={onNodesChange} onConnect={connect} nodeDragThreshold={1}
      onNodeDragStart={() => breakRun(history)}
      onNodeClick={(_, node) => { setSelectedId(node.id); setPrepared(false); setNotice(''); }}
      onPaneClick={() => { setSelectedId(''); setSelectionCount(0); setPrepared(false); setNotice(''); }}
      onSelectionChange={({ nodes: selectedNodes }) => setSelectionCount(selectedNodes.length)} defaultViewport={project.viewport}
      onMoveEnd={(_, viewport) => {
        if (JSON.stringify(viewport) !== JSON.stringify(projectRef.current.viewport)) change({ ...projectRef.current, viewport });
      }} minZoom={0.1} maxZoom={4} panOnScroll zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
      panOnDrag={space ? [0, 1] : [1]} selectionOnDrag={!space} multiSelectionKeyCode="Shift" deleteKeyCode={null} selectionKeyCode={null}>
      <Background color="#2a2a28" gap={24} size={1} />
      {minimap && <MiniMap<CardNode> nodeColor={node => isMediaNode(node.data.item) ? '#8a8a84' : '#4a4a46'} pannable zoomable />}
    </ReactFlow>}
    <div className="canvas-caption">参考画布</div>
    <div className="zoom-tools"><button aria-label="缩小" onClick={() => void flow.zoomOut()}>-</button><output data-testid="viewport">{Math.round(project.viewport.zoom * 100)}%</output><button aria-label="放大" onClick={() => void flow.zoomIn()}>+</button></div>
  </section>;
}
