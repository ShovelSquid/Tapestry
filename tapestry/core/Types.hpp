#pragma once

namespace tapestry {

// World- and screen-space point. Doubles throughout: these coordinates are view
// state and page geometry, never simulation state, so precision here costs
// nothing and keeps long pan sessions from accumulating drift.
struct Vec2 {
    double x = 0.0;
    double y = 0.0;
};

constexpr Vec2 operator+(Vec2 a, Vec2 b) { return {a.x + b.x, a.y + b.y}; }
constexpr Vec2 operator-(Vec2 a, Vec2 b) { return {a.x - b.x, a.y - b.y}; }
constexpr Vec2 operator*(Vec2 v, double s) { return {v.x * s, v.y * s}; }

// Axis-aligned rectangle in world space. Pages store a centre and a size; this
// is the derived form used for culling and hit-testing.
struct Rect {
    double x = 0.0;
    double y = 0.0;
    double w = 0.0;
    double h = 0.0;

    constexpr double right() const { return x + w; }
    constexpr double bottom() const { return y + h; }

    constexpr bool intersects(const Rect& other) const {
        return x < other.right() && other.x < right()
            && y < other.bottom() && other.y < bottom();
    }

    constexpr bool contains(Vec2 p) const {
        return p.x >= x && p.x < right() && p.y >= y && p.y < bottom();
    }

    // Smallest rectangle covering both. Used to build content bounds by
    // folding over page rects.
    constexpr Rect unionWith(const Rect& other) const {
        const double nx = x < other.x ? x : other.x;
        const double ny = y < other.y ? y : other.y;
        const double nr = right() > other.right() ? right() : other.right();
        const double nb = bottom() > other.bottom() ? bottom() : other.bottom();
        return {nx, ny, nr - nx, nb - ny};
    }
};

} // namespace tapestry
