"""Tapestry for Blender: plays a baked Tapestry world as native Blender animation.

Blender is a host and only shows appearance (spec principle 10). The core runs
as a separate program (`tapestry-bake`); this add-on reads what it writes.
Blender keyframes here are a regenerable cache of the world's history. They are
not Tapestry keys, and editing them does not change the story.

Each point becomes one object, parented the way the point is, so Tapestry's
nested spatial frames are Blender's parent hierarchy. Each blob is meshed once
and only moved afterwards (spec §5.3).
"""

import json
import os
import subprocess
import tempfile
from math import pi

import bmesh
import bpy
from mathutils import Vector

COLLECTION = "Tapestry"
ROOT = "Tapestry"
DEFAULT_COMMAND = "~/Tapestrees/core/target/release/tapestry-bake"
LINEAR, CONSTANT = 1, 0


# ---------------------------------------------------------------- loading


def _clear(scene):
    coll = bpy.data.collections.get(COLLECTION)
    if coll:
        for obj in list(coll.objects):
            action = obj.animation_data and obj.animation_data.action
            bpy.data.objects.remove(obj)
            if action and action.users == 0:
                bpy.data.actions.remove(action)
        bpy.data.collections.remove(coll)
    # Markers can't be tagged, so remove only the ones the last load made.
    ours = {_marker_name(k) for k in json.loads(scene.get("tapestry_keys", "[]"))}
    for m in [m for m in scene.timeline_markers if m.name in ours]:
        scene.timeline_markers.remove(m)
    for mesh in [m for m in bpy.data.meshes if m.get("tapestry") and m.users == 0]:
        bpy.data.meshes.remove(mesh)


def _marker_name(key):
    return f"{key['id']} {key['kind']}"


def _material(color, cache):
    key = tuple(round(c, 4) for c in color)
    if key not in cache:
        name = "tap:" + "".join(f"{int(min(c, 1) * 255):02x}" for c in key[:3])
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.diffuse_color = color  # what Solid view shows
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Roughness"].default_value = 0.6
        cache[key] = mat
    return cache[key]


def _ellipsoid(radii, cache):
    key = tuple(round(r, 6) for r in radii)
    if key not in cache:
        mesh = bpy.data.meshes.new("tap:blob")
        mesh["tapestry"] = True
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        bm.to_mesh(mesh)
        bm.free()
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        cache[key] = mesh
    return cache[key]


def _curve(action, obj, path, index, frames, values, interpolation):
    fc = action.fcurve_ensure_for_datablock(obj, path, index=index)
    n = len(frames)
    fc.keyframe_points.add(n)
    co = [0.0] * (2 * n)
    co[0::2] = frames
    co[1::2] = values
    fc.keyframe_points.foreach_set("co", co)
    fc.keyframe_points.foreach_set("interpolation", [interpolation] * n)
    fc.update()


def _animate(obj, track):
    frames = [float(f) for f in track["frames"]]
    action = bpy.data.actions.new(f"tap:{track['id']}")
    obj.animation_data_create()
    obj.animation_data.action = action
    loc, rot = track["location"], track["rotation"]
    for i in range(3):
        _curve(action, obj, "location", i, frames, loc[i::3], LINEAR)
    for i in range(4):
        _curve(action, obj, "rotation_quaternion", i, frames, rot[i::4], LINEAR)
    for i in range(3):
        _curve(action, obj, "scale", i, frames, track["scale"], LINEAR)
    hidden = [0.0 if v else 1.0 for v in track["visible"]]
    for path in ("hide_viewport", "hide_render"):
        _curve(action, obj, path, 0, frames, hidden, CONSTANT)


def _stage(scene, coll):
    """A camera and a sun, only if the scene has none, so a render shows something."""
    if not any(o.type == "LIGHT" for o in scene.objects):
        sun = bpy.data.objects.new("tap:sun", bpy.data.lights.new("tap:sun", "SUN"))
        sun.data.energy = 3.0
        sun.rotation_euler = (0.7, 0.2, 0.6)
        coll.objects.link(sun)
    if scene.camera is None:
        cam = bpy.data.objects.new("tap:camera", bpy.data.cameras.new("tap:camera"))
        # The viewer's default view, converted from Y-up to Blender's Z-up.
        cam.location = (3.2, -4.3, 2.6)
        target = Vector((0.6, 0.0, 0.6))
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")
        coll.objects.link(cam)
        scene.camera = cam


def load_bake(bake, scene=None):
    scene = scene or bpy.context.scene
    if not bake.get("format", "").startswith("tapestry-bake/"):
        raise ValueError("not a Tapestry bake")
    _clear(scene)

    coll = bpy.data.collections.new(COLLECTION)
    scene.collection.children.link(coll)

    # One root that turns the world's Y-up into Blender's Z-up for everything below it.
    root = bpy.data.objects.new(ROOT, None)
    root.empty_display_size = 0.2
    if bake.get("up", "y") == "y":
        root.rotation_euler = (pi / 2, 0.0, 0.0)
    coll.objects.link(root)

    meshes, materials, objects = {}, {}, {}
    for track in bake["points"]:
        blob = track["blob"]
        if blob:
            obj = bpy.data.objects.new(track["id"], _ellipsoid(blob["radii"], meshes))
            obj.active_material = _material(blob["color"], materials)
        else:
            obj = bpy.data.objects.new(track["id"], None)
            obj.empty_display_size = 0.1
        obj["tapestry_id"] = track["id"]
        obj.rotation_mode = "QUATERNION"
        obj.show_name = bool(track.get("label"))
        coll.objects.link(obj)
        obj.parent = objects[track["parent"]] if track["parent"] else root
        objects[track["id"]] = obj
        _animate(obj, track)

    for key in bake["keys"]:
        if key["frame"] is not None:
            scene.timeline_markers.new(_marker_name(key), frame=round(key["frame"]))

    scene.render.fps = bake["fps"]
    scene.frame_start = bake["frame_start"]
    scene.frame_end = bake["frame_end"]
    scene["tapestry_keys"] = json.dumps(bake["keys"])
    scene["tapestry_gaps"] = json.dumps(bake["gaps"])
    _stage(scene, coll)
    scene.frame_set(scene.frame_current)
    return len(objects)


def run_bake(command, fps):
    out = os.path.join(tempfile.gettempdir(), "tapestry-bake.json")
    exe = os.path.expanduser(command)
    result = subprocess.run([exe, "--fps", str(fps), "--out", out], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"{exe} failed")
    with open(out) as f:
        return json.load(f), result.stderr.strip()


# ---------------------------------------------------------------- UI


def _command(context):
    addon = context.preferences.addons.get(__package__)
    return addon.preferences.bake_command if addon else DEFAULT_COMMAND


class TapestryPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    bake_command: bpy.props.StringProperty(
        name="Bake tool",
        description="Path to the tapestry-bake program",
        default=DEFAULT_COMMAND,
        subtype="FILE_PATH",
    )

    def draw(self, context):
        self.layout.prop(self, "bake_command")


class TAPESTRY_OT_rebake(bpy.types.Operator):
    """Run the Tapestry core and load its history into this scene"""

    bl_idname = "tapestry.rebake"
    bl_label = "Rebake"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            bake, log = run_bake(_command(context), context.scene.render.fps)
            n = load_bake(bake, context.scene)
        except Exception as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        self.report({"INFO"}, log or f"Loaded {n} points")
        return {"FINISHED"}


class TAPESTRY_OT_load(bpy.types.Operator):
    """Load a Tapestry bake file"""

    bl_idname = "tapestry.load"
    bl_label = "Load Bake File"
    bl_options = {"REGISTER", "UNDO"}

    filepath: bpy.props.StringProperty(subtype="FILE_PATH")
    filter_glob: bpy.props.StringProperty(default="*.json", options={"HIDDEN"})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        with open(self.filepath) as f:
            n = load_bake(json.load(f), context.scene)
        self.report({"INFO"}, f"Loaded {n} points")
        return {"FINISHED"}


class TAPESTRY_PT_panel(bpy.types.Panel):
    bl_label = "Tapestry"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Tapestry"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        row = layout.row(align=True)
        row.operator(TAPESTRY_OT_rebake.bl_idname, icon="FILE_REFRESH")
        row.operator(TAPESTRY_OT_load.bl_idname, text="", icon="FILE_FOLDER")

        keys = json.loads(scene.get("tapestry_keys", "[]"))
        if keys:
            box = layout.box()
            box.label(text="Keys")
            for k in keys:
                when = "always" if k["frame"] is None else f"frame {k['frame']:g}"
                box.label(text=f"{k['id']}  {k['kind']}  ·  {when}")
                box.label(text=k["text"], icon="BLANK1")

        if "tapestry_gaps" in scene:
            box = layout.box()
            box.label(text="Gap report")
            gaps = json.loads(scene["tapestry_gaps"])
            if not gaps:
                box.label(text="No bounded gaps", icon="CHECKMARK")
            for g in gaps:
                box.label(text=g, icon="ERROR")


CLASSES = (TapestryPreferences, TAPESTRY_OT_rebake, TAPESTRY_OT_load, TAPESTRY_PT_panel)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
