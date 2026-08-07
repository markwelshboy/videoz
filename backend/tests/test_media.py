from app.media import _display_dimensions


def test_display_dimensions_without_rotation():
    assert _display_dimensions({"width": 2160, "height": 3840}) == (2160, 3840)


def test_display_dimensions_swaps_for_side_data_rotation():
    stream = {
        "width": 3840,
        "height": 2160,
        "side_data_list": [{"rotation": -90}],
    }
    assert _display_dimensions(stream) == (2160, 3840)


def test_display_dimensions_swaps_for_rotate_tag():
    stream = {
        "width": 1920,
        "height": 1080,
        "tags": {"rotate": "90"},
    }
    assert _display_dimensions(stream) == (1080, 1920)
